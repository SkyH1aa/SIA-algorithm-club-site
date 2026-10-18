#!/usr/bin/env python3
"""Disposable LOCAL PostgreSQL proxy integration test; no project env/secrets.
python tools/test-chat-proxy-sql.py --syntax-only
python tools/test-chat-proxy-sql.py --dsn 'host=127.0.0.1 port=5432 dbname=postgres user=postgres'
Requires pglast and psycopg[binary]. Never connects to remote or modifies source DB.
"""
import argparse
import os
import uuid
import time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dsn')
    parser.add_argument('--syntax-only', action='store_true')
    args = parser.parse_args()
    from pglast import parse_sql, parse_plpgsql
    source = (Path(__file__).resolve().parents[1] / 'supabase/club-chat-schema.sql').read_text(encoding='utf-8')
    print(f'SQL {len(parse_sql(source))}, PLpgSQL {len(parse_plpgsql(source))} parsed')
    if args.syntax_only:
        return
    if not args.dsn:
        parser.error('Explicit local --dsn required; no implicit environment connection')
    import psycopg
    from psycopg import sql
    from psycopg.conninfo import conninfo_to_dict, make_conninfo
    from psycopg.types.json import Jsonb
    params = conninfo_to_dict(args.dsn)
    if params.get('host') not in ('127.0.0.1', '::1', '/tmp') or params.get('hostaddr') not in (None, '127.0.0.1', '::1') or 'service' in params:
        parser.error('Only explicit local hosts permitted')
    for key in list(os.environ):
        if key.startswith('PG'):
            os.environ.pop(key)
    params.setdefault('passfile', os.devnull)
    admin = psycopg.connect(make_conninfo(**params), autocommit=True)
    name = 'chat_proxy_test_' + uuid.uuid4().hex
    roles, created = [], False
    try:
        for role in ('anon', 'authenticated', 'service_role'):
            if not admin.execute('select 1 from pg_roles where rolname=%s', (role,)).fetchone():
                admin.execute(sql.SQL('create role {} nologin').format(sql.Identifier(role)))
                roles.append(role)
        admin.execute(sql.SQL('create database {}').format(sql.Identifier(name)))
        created = True
        params['dbname'] = name
        dsn = make_conninfo(**params)
        def connect():
            return psycopg.connect(dsn, autocommit=True)
        with connect() as db:
            db.execute("create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'::jsonb)")
            db.execute('create table club_super_admins(user_id uuid primary key references auth.users(id)); create table club_member_profiles(user_id uuid primary key,username text,member_name text)')
            db.execute(source)
            db.execute(source)
            actor, member = uuid.uuid4(), uuid.uuid4()
            db.execute('insert into auth.users(id) values (%s),(%s)', (actor, member))
            db.execute('insert into club_super_admins values (%s)', (actor,))
            route_base = 'https://jgezpvmlnhycxslqbwcx.supabase.co/functions/v1/chat-api-proxy/' + str(uuid.uuid4())
            for suffix in ('', '/v1', '/responses', '/v1/responses', '/messages', '/v1/messages', '/v1/message', '/chat/completions', '/v1/chat/completions'):
                model_id = uuid.uuid4()
                row = db.execute('select chat_custom_model_save(%s,%s,%s,%s,%s,%s)',
                                 (member, model_id, 'Native model', 'model-id', route_base + suffix, 0)).fetchone()[0]
                assert row['base_url'] == route_base + suffix
            for suffix in ('/models', '/v1/response', '/v1/messages/extra', '?target=x'):
                try:
                    db.execute('select chat_custom_model_save(%s,%s,%s,%s,%s,%s)',
                               (member, uuid.uuid4(), 'Invalid', 'model-id', route_base + suffix, 0))
                    raise AssertionError('invalid native custom URL accepted')
                except psycopg.errors.InvalidParameterValue:
                    pass
            def rpc(fn, *values, conn=db):
                return conn.execute(sql.SQL('select public.{}({})').format(sql.Identifier(fn), sql.SQL(',').join(sql.Placeholder() for _ in values)), values).fetchone()[0]
            def manage(action, data, who=actor, conn=db):
                return rpc('chat_proxy_admin', who, action, Jsonb(data), conn=conn)
            create = dict(id=None, name='test', base_url='https://provider.example/v1', secret_name='CHAT_KEY_TEST', enabled=True, expected_version=0)
            try:
                manage('admin_proxy_list', {}, member)
                raise AssertionError('nonadmin allowed')
            except psycopg.errors.InsufficientPrivilege:
                pass
            r = manage('admin_proxy_save', create)['route']
            rid = uuid.UUID(r['id'])
            data = dict(route_id=str(rid), label='test', key_hash='a'*64, key_prefix='cap_test1234', key_last4='1234')
            k = manage('admin_proxy_key_create', data)['key']
            assert set(k) == set('id route_id label key_prefix key_last4 enabled revoked_at version created_at'.split())
            assert 'key_hash' not in str(manage('admin_proxy_list', {}))
            assert manage('admin_proxy_route_state', dict(id=str(rid), enabled=False, expected_version=2))['code'] == 'conflict'
            def admit(conn=db, key_hash='a'*64, key_limit=2, route_limit=20):
                req = uuid.uuid4()
                return req, rpc('chat_proxy_admit', rid, key_hash, req, key_limit, route_limit, 1000, conn=conn)
            def concurrent(_):
                with connect() as conn:
                    return admit(conn)
            with ThreadPoolExecutor(max_workers=8) as pool:
                attempts = list(pool.map(concurrent, range(8)))
            assert sum('route' in result for _, result in attempts) == 2
            assert sum(result.get('code') == 'busy' for _, result in attempts) == 6
            for req, _ in attempts:
                rpc('chat_proxy_release', req)
            req, result = admit()
            assert 'route' in result
            rpc('chat_proxy_release', req)
            rpc('chat_proxy_release', req)  # idempotent
            # Route aggregate capacity applies across different keys.
            manage('admin_proxy_key_create', {**data, 'key_hash':'b'*64})
            req, result = admit(route_limit=1)
            assert 'route' in result
            assert admit(key_hash='b'*64, route_limit=1)[1]['code'] == 'busy'
            db.execute("update chat_proxy_leases set expires_at=now()-interval '1 second'")
            req2, result = admit(key_hash='b'*64, route_limit=1)
            assert 'route' in result
            rpc('chat_proxy_release', req2)
            # Hard-delete contracts are independently strict at the SQL boundary.
            hard_actions = ('admin_proxy_route_hard_delete', 'admin_proxy_key_hard_delete')
            for action, target in zip(hard_actions, (str(rid), k['id'])):
                valid = dict(id=target, expected_version=1)
                for invalid in (None, [], 'invalid'):
                    try:
                        manage(action, invalid)
                        raise AssertionError('nonobject hard-delete payload accepted')
                    except psycopg.errors.RaiseException as error:
                        assert 'invalid data' in str(error)
                for change in (dict(id=None), dict(id=5), dict(id='bad'),
                               dict(expected_version=None), dict(expected_version=True),
                               dict(expected_version='1'), dict(expected_version=0),
                               dict(expected_version=-1), dict(expected_version=1.5),
                               dict(expected_version=9007199254740992), dict(extra=True)):
                    try:
                        manage(action, {**valid, **change})
                        raise AssertionError('invalid hard-delete payload accepted')
                    except psycopg.errors.RaiseException as error:
                        assert 'invalid data' in str(error)
                for missing in ('id', 'expected_version'):
                    try:
                        manage(action, {key: value for key, value in valid.items() if key != missing})
                        raise AssertionError('missing hard-delete field accepted')
                    except psycopg.errors.RaiseException as error:
                        assert 'invalid data' in str(error)
                assert manage(action, dict(id=str(uuid.uuid4()), expected_version=1)) == {'code': 'not_found'}
                assert manage(action, {**valid, 'expected_version': 2}) == {'code': 'conflict'}
                assert manage(action, valid) == {'code': 'not_revoked'}
                try:
                    manage(action, valid, member)
                    raise AssertionError('member allowed to hard-delete')
                except psycopg.errors.InsufficientPrivilege:
                    pass
            # Disabled keys remain ineligible; a revoked key can be removed without
            # affecting its route, sibling key, or sibling's active lease.
            disabled_key = manage('admin_proxy_key_state', dict(id=k['id'], enabled=False, revoked=False, expected_version=1))['key']
            assert manage(hard_actions[1], dict(id=k['id'], expected_version=disabled_key['version'])) == {'code': 'not_revoked'}
            revoked_key = manage('admin_proxy_key_state', dict(id=k['id'], enabled=False, revoked=True, expected_version=disabled_key['version']))['key']
            assert manage(hard_actions[1], dict(id=k['id'], expected_version=disabled_key['version'])) == {'code': 'conflict'}
            sibling_req, result = admit(key_hash='b'*64)
            assert 'route' in result
            orphan_req = uuid.uuid4()
            db.execute("insert into chat_proxy_leases(request_id,route_id,key_id,expires_at) values(%s,%s,%s,now()+interval '1 minute')", (orphan_req, rid, k['id']))
            # A caller rollback restores both rows: no partial lease/key deletion.
            with db.transaction():
                db.execute('savepoint hard_delete')
                assert manage(hard_actions[1], dict(id=k['id'], expected_version=revoked_key['version'])) == {'deleted_key_id': k['id']}
                assert not db.execute('select 1 from chat_proxy_keys where id=%s', (k['id'],)).fetchone()
                assert not db.execute('select 1 from chat_proxy_leases where request_id=%s', (orphan_req,)).fetchone()
                db.execute('rollback to savepoint hard_delete')
            assert db.execute('select 1 from chat_proxy_keys where id=%s', (k['id'],)).fetchone()
            assert db.execute('select 1 from chat_proxy_leases where request_id=%s', (orphan_req,)).fetchone()
            def assert_delete_waits(table, target, action, payload):
                # Run the mutation in a separate session and roll it back. Holding
                # either parent or child proves it honors both admission locks.
                marker = 'hard_delete_' + uuid.uuid4().hex
                def waiting_delete():
                    with connect() as conn:
                        conn.execute("select set_config('application_name',%s,false)", (marker,))
                        conn.execute("set statement_timeout='10s'")
                        with conn.transaction():
                            result = manage(action, payload, conn=conn)
                            assert 'code' not in result, result
                            raise psycopg.Rollback()
                with ThreadPoolExecutor(max_workers=1) as pool:
                    with db.transaction():
                        db.execute(sql.SQL('select id from {} where id=%s for update').format(sql.Identifier(table)), (target,))
                        future = pool.submit(waiting_delete)
                        deadline = time.monotonic() + 5
                        while True:
                            # Statistics snapshots are cached within a transaction.
                            db.execute('select pg_stat_clear_snapshot()')
                            if db.execute("select 1 from pg_stat_activity where application_name=%s and wait_event_type='Lock'", (marker,)).fetchone():
                                break
                            if future.done():
                                future.result()
                                raise AssertionError('hard-delete bypassed admission lock')
                            assert time.monotonic() < deadline, 'hard-delete did not reach lock'
                            time.sleep(0.01)
                    future.result(timeout=5)
            key_payload = dict(id=k['id'], expected_version=revoked_key['version'])
            assert_delete_waits('chat_proxy_routes', rid, hard_actions[1], key_payload)
            assert_delete_waits('chat_proxy_keys', k['id'], hard_actions[1], key_payload)
            # The service-role caller still requires the dynamic actor check.
            with db.transaction():
                db.execute('set local role service_role')
                assert manage(hard_actions[1], dict(id=k['id'], expected_version=revoked_key['version'])) == {'deleted_key_id': k['id']}
            assert admit()[1] == {'code': 'invalid_key'}
            assert db.execute('select 1 from chat_proxy_routes where id=%s', (rid,)).fetchone()
            assert db.execute('select 1 from chat_proxy_leases where request_id=%s', (sibling_req,)).fetchone()
            assert manage(hard_actions[1], dict(id=k['id'], expected_version=revoked_key['version'])) == {'code': 'not_found'}
            rpc('chat_proxy_release', orphan_req)  # late cleanup after hard delete
            rpc('chat_proxy_release', sibling_req)
            prior_revoked = manage('admin_proxy_key_create', {**data, 'key_hash': 'c'*64})['key']
            prior_revoked = manage('admin_proxy_key_state', dict(id=prior_revoked['id'], enabled=False, revoked=True, expected_version=prior_revoked['version']))['key']
            r = manage('admin_proxy_route_state', dict(id=str(rid), enabled=False, expected_version=1))['route']
            assert manage(hard_actions[0], dict(id=str(rid), expected_version=r['version'])) == {'code': 'not_revoked'}
            assert admit()[1]['code'] == 'invalid_key'
            deleted = manage('admin_proxy_route_delete', dict(id=str(rid), expected_version=r['version']))['route']
            assert deleted['enabled'] is False and deleted['deleted_at'] is not None
            assert admit()[1]['code'] == 'invalid_key'
            assert manage('admin_proxy_route_state', dict(id=str(rid), enabled=True, expected_version=deleted['version']))['code'] == 'deleted'
            assert manage('admin_proxy_route_delete', dict(id=str(rid), expected_version=deleted['version']))['code'] == 'deleted'
            listed_keys = manage('admin_proxy_list', {})['keys']
            deleted_key = next(key for key in listed_keys if key['id'] != prior_revoked['id'])
            assert next(key for key in listed_keys if key['id'] == prior_revoked['id']) == prior_revoked
            assert deleted_key['revoked_at'] is not None and deleted_key['enabled'] is False
            assert manage('admin_proxy_key_state', dict(id=deleted_key['id'], enabled=True, revoked=False, expected_version=deleted_key['version']))['code'] == 'revoked'
            # A standalone revoked key remains deletable on a tombstoned route.
            with db.transaction():
                assert manage(hard_actions[1], dict(id=prior_revoked['id'], expected_version=prior_revoked['version'])) == {'deleted_key_id': prior_revoked['id']}
                raise psycopg.Rollback()
            route_payload = dict(id=str(rid), expected_version=deleted['version'])
            assert manage(hard_actions[0], {**route_payload, 'expected_version': r['version']}) == {'code': 'conflict'}
            # Leave a lease behind to exercise explicit FK-safe cleanup, including
            # a previously revoked child, as can happen during late worker cleanup.
            for child in (deleted_key, prior_revoked):
                db.execute("insert into chat_proxy_leases(request_id,route_id,key_id,expires_at) values(%s,%s,%s,now()+interval '1 minute')", (uuid.uuid4(), rid, child['id']))
            assert_delete_waits('chat_proxy_routes', rid, hard_actions[0], route_payload)
            assert_delete_waits('chat_proxy_keys', deleted_key['id'], hard_actions[0], route_payload)
            with db.transaction():
                db.execute('savepoint hard_delete')
                assert manage(hard_actions[0], route_payload) == {'deleted_route_id': str(rid)}
                assert not db.execute('select 1 from chat_proxy_routes where id=%s', (rid,)).fetchone()
                assert not db.execute('select 1 from chat_proxy_keys where route_id=%s', (rid,)).fetchone()
                assert not db.execute('select 1 from chat_proxy_leases where route_id=%s', (rid,)).fetchone()
                db.execute('rollback to savepoint hard_delete')
            assert db.execute('select 1 from chat_proxy_routes where id=%s', (rid,)).fetchone()
            assert db.execute('select 1 from chat_proxy_keys where route_id=%s', (rid,)).fetchone()
            assert db.execute('select 1 from chat_proxy_leases where route_id=%s', (rid,)).fetchone()
            # Revocation of the actor is checked afresh even for eligible records.
            db.execute('delete from club_super_admins where user_id=%s', (actor,))
            for action, target in ((hard_actions[0], route_payload), (hard_actions[1], dict(id=deleted_key['id'], expected_version=deleted_key['version']))):
                try:
                    manage(action, target)
                    raise AssertionError('removed admin allowed to hard-delete')
                except psycopg.errors.InsufficientPrivilege:
                    pass
            db.execute('insert into club_super_admins values (%s)', (actor,))
            with db.transaction():
                db.execute('set local role service_role')
                assert manage(hard_actions[0], route_payload) == {'deleted_route_id': str(rid)}
            assert admit(key_hash='b'*64)[1] == {'code': 'invalid_key'}
            assert manage(hard_actions[0], route_payload) == {'code': 'not_found'}
            assert manage(hard_actions[1], dict(id=deleted_key['id'], expected_version=deleted_key['version'])) == {'code': 'not_found'}
            assert manage('admin_proxy_list', {}) == {'routes': [], 'keys': []}
            # Check all public roles, not merely RLS flags.
            for role in ('anon', 'authenticated'):
                assert not db.execute('select has_table_privilege(%s,%s,%s)', (role,'public.chat_proxy_keys','SELECT')).fetchone()[0]
                assert not db.execute('select has_function_privilege(%s,%s,%s)', (role,'public.chat_proxy_admin(uuid,text,jsonb)','EXECUTE')).fetchone()[0]
                for action, target in ((hard_actions[0], route_payload), (hard_actions[1], dict(id=deleted_key['id'], expected_version=deleted_key['version']))):
                    try:
                        with db.transaction():
                            db.execute(sql.SQL('set local role {}').format(sql.Identifier(role)))
                            manage(action, target)
                        raise AssertionError('public role executed hard-delete')
                    except psycopg.errors.InsufficientPrivilege:
                        pass
            db.execute('delete from club_super_admins where user_id=%s', (actor,))
            try:
                manage('admin_proxy_list', {})
                raise AssertionError('removed admin allowed')
            except psycopg.errors.InsufficientPrivilege:
                pass
        print('PASS proxy SQL: idempotence, dynamic admin, metadata, CAS, concurrent caps, expiry/release, tombstones, hard-delete eligibility/locks/rollback/FK cleanup, deleted credentials, grants')
    finally:
        if created:
            admin.execute(sql.SQL('drop database {} with (force)').format(sql.Identifier(name)))
        for role in roles:
            admin.execute(sql.SQL('drop role {}').format(sql.Identifier(role)))
        admin.close()


if __name__ == '__main__':
    main()
