#!/usr/bin/env python3
"""Disposable LOCAL PostgreSQL proxy integration test; no project env/secrets.
python tools/test-chat-proxy-sql.py --syntax-only
python tools/test-chat-proxy-sql.py --dsn 'host=127.0.0.1 port=5432 dbname=postgres user=postgres'
Requires pglast and psycopg[binary]. Never connects to remote or modifies source DB.
"""
import argparse
import os
import uuid
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
            data = dict(route_id=str(rid), label='test', key_hash='a'*64, key_prefix='cap_test', key_last4='1234')
            k = manage('admin_proxy_key_create', data)['key']
            assert set(k) == set('id route_id label key_prefix key_last4 enabled revoked_at version created_at'.split())
            assert 'key_hash' not in str(manage('admin_proxy_list', {}))
            assert manage('admin_proxy_route_state', dict(id=str(rid), enabled=False, expected_version=0))['code'] == 'conflict'
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
            r = manage('admin_proxy_route_state', dict(id=str(rid), enabled=False, expected_version=1))['route']
            assert admit()[1]['code'] == 'invalid_key'
            deleted = manage('admin_proxy_route_delete', dict(id=str(rid), expected_version=r['version']))['route']
            assert deleted['enabled'] is False and deleted['deleted_at'] is not None
            assert admit()[1]['code'] == 'invalid_key'
            assert manage('admin_proxy_route_state', dict(id=str(rid), enabled=True, expected_version=deleted['version']))['code'] == 'deleted'
            assert manage('admin_proxy_route_delete', dict(id=str(rid), expected_version=deleted['version']))['code'] == 'deleted'
            deleted_key = manage('admin_proxy_list', {})['keys'][0]
            assert deleted_key['revoked_at'] is not None and deleted_key['enabled'] is False
            assert manage('admin_proxy_key_state', dict(id=deleted_key['id'], enabled=True, revoked=False, expected_version=deleted_key['version']))['code'] == 'revoked'
            # Check all public roles, not merely RLS flags.
            for role in ('anon', 'authenticated'):
                assert not db.execute('select has_table_privilege(%s,%s,%s)', (role,'public.chat_proxy_keys','SELECT')).fetchone()[0]
                assert not db.execute('select has_function_privilege(%s,%s,%s)', (role,'public.chat_proxy_admin(uuid,text,jsonb)','EXECUTE')).fetchone()[0]
            db.execute('delete from club_super_admins where user_id=%s', (actor,))
            try:
                manage('admin_proxy_list', {})
                raise AssertionError('removed admin allowed')
            except psycopg.errors.InsufficientPrivilege:
                pass
        print('PASS proxy SQL: idempotence, dynamic admin, metadata, CAS, concurrent key/route caps, expiry/release, revocation, grants')
    finally:
        if created:
            admin.execute(sql.SQL('drop database {} with (force)').format(sql.Identifier(name)))
        for role in roles:
            admin.execute(sql.SQL('drop role {}').format(sql.Identifier(role)))
        admin.close()


if __name__ == '__main__':
    main()
