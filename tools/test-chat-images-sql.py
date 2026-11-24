#!/usr/bin/env python3
"""Image quota integration tests. Only explicit loopback DSNs; disposable database.

Run --syntax-only with pglast, or --dsn 'host=127.0.0.1 ...' with psycopg.
Never reads project credentials or modifies the supplied database.
"""
import argparse
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import uuid

SOURCE = (Path(__file__).resolve().parents[1] / 'supabase/club-chat-schema.sql').read_text(encoding='utf-8')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--syntax-only', action='store_true')
    parser.add_argument('--dsn')
    args = parser.parse_args()
    from pglast import parse_sql, parse_plpgsql
    print('SQL statements:', len(parse_sql(SOURCE)), 'PL/pgSQL functions:', len(parse_plpgsql(SOURCE)))
    if args.syntax_only:
        return
    if not args.dsn:
        parser.error('explicit local --dsn required')
    import psycopg
    from psycopg import sql
    from psycopg.conninfo import conninfo_to_dict, make_conninfo
    from psycopg.types.json import Jsonb

    params = conninfo_to_dict(args.dsn)
    if params.get('host') not in ('127.0.0.1', '::1', '/tmp') or params.get('hostaddr') not in (None, '127.0.0.1', '::1') or 'service' in params:
        parser.error('only explicit loopback hosts accepted')
    for key in list(os.environ):
        if key.startswith('PG'):
            os.environ.pop(key)
    params.setdefault('passfile', os.devnull)
    dsn = make_conninfo(**params)
    name = 'chat_images_test_' + uuid.uuid4().hex
    admin = psycopg.connect(dsn, autocommit=True)
    created_roles = []
    created_db = False
    try:
        for role in ('anon', 'authenticated', 'service_role'):
            if not admin.execute('select 1 from pg_roles where rolname=%s', (role,)).fetchone():
                admin.execute(sql.SQL('create role {} nologin').format(sql.Identifier(role)))
                created_roles.append(role)
        admin.execute(sql.SQL('create database {}').format(sql.Identifier(name)))
        created_db = True
        test_dsn = make_conninfo(dsn, dbname=name)
        def connect():
            return psycopg.connect(test_dsn, autocommit=True)
        with connect() as db:
            db.execute("create schema auth; create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb)")
            db.execute('create table public.club_super_admins(user_id uuid primary key references auth.users(id))')
            db.execute('create table public.club_member_profiles(user_id uuid primary key references auth.users(id), username text, member_name text)')
            db.execute(SOURCE)
            actor, user = uuid.uuid4(), uuid.uuid4()
            db.execute('insert into auth.users(id) values (%s),(%s)', (actor, user))
            db.execute('insert into club_super_admins values (%s)', (actor,))
            provider = db.execute("insert into chat_providers(name,base_url,secret_name) values ('test','https://invalid.local','CHAT_KEY_TEST') returning id").fetchone()[0]
            model = db.execute("insert into chat_models(provider_id,model_key,display_name,context_window,max_output_tokens,default_max_output_tokens,purpose) values (%s,'same','Image',4096,100,100,'image') returning id", (provider,)).fetchone()[0]
            db.execute("insert into chat_models(provider_id,model_key,display_name,context_window,max_output_tokens,default_max_output_tokens) values (%s,'same','Chat',4096,100,100)", (provider,))
            def rpc(conn, function, *values):
                return conn.execute(sql.SQL('select public.{}({})').format(sql.Identifier(function), sql.SQL(',').join(sql.Placeholder() for _ in values)), values).fetchone()[0]
            def call(function, *values):
                return rpc(db, function, *values)
            digest = 'a' * 64
            request = uuid.uuid4()
            assert not call('chat_image_begin', user, request, model, 1, digest, Jsonb({}))['allowed']
            call('chat_image_admin_save', actor, Jsonb({'global_daily_limit': None, 'default_user_daily_limit': 3,
                                                       'user_id': str(user), 'user_daily_limit': None}))
            q = call('chat_image_quota_get', user)
            assert q['global']['limit'] is None and q['user']['limit'] is None
            call('chat_image_admin_save', actor, Jsonb({'global_daily_limit': 3, 'user_id': str(user), 'reset_user_override': True}))
            assert call('chat_image_quota_get', user)['user']['limit'] == 3
            for audit in ({'prompt': 'secret'}, {'raw_image': 'secret'}, {'provider_id': 'bad'}):
                try:
                    call('chat_image_begin', user, uuid.uuid4(), model, 1, digest, Jsonb(audit))
                except psycopg.Error:
                    pass
                else:
                    raise AssertionError('Unsafe audit accepted')
            db.execute(SOURCE)  # Migration does not reset settings.
            assert call('chat_image_quota_get', user)['global']['limit'] == 3
            # Simultaneous full batches must not overbook either quota.
            def begin(_):
                with connect() as conn:
                    return rpc(conn, 'chat_image_begin', user, uuid.uuid4(), model, 2, digest, Jsonb({}))
            with ThreadPoolExecutor(max_workers=6) as pool:
                results = list(pool.map(begin, range(6)))
            assert sum(x['allowed'] for x in results) == 1
            row = db.execute('select request_id from chat_image_requests where user_id=%s', (user,)).fetchone()[0]
            assert call('chat_image_begin', user, row, model, 2, digest, Jsonb({}))['allowed']
            assert call('chat_image_begin', user, row, model, 2, 'b' * 64, Jsonb({}))['code'] == 'request_conflict'
            assert call('chat_image_claim', user, row, 0, digest)['allowed']
            assert not call('chat_image_claim', user, row, 0, digest)['allowed']
            assert call('chat_image_dispatch', user, row, 0)['allowed']
            assert not call('chat_image_dispatch', user, row, 0)['allowed']
            call('chat_image_cancel', user, row)
            q = call('chat_image_quota_get', user)
            assert q['global']['used'] == 1 and q['global']['reserved'] == 1
            call('chat_image_finish', user, row, 0, 'uncertain', 0, 'timeout', False)
            assert call('chat_image_quota_get', user)['global']['used'] == 1
            call('chat_image_admin_resolve', actor, row, 0, 1, 'Confirmed successful')
            assert call('chat_image_admin_resolve', actor, row, 0, 0, 'Again')['code'] == 'slot_unavailable'
            q = call('chat_image_quota_get', user)
            assert q['global']['used'] == q['global']['generated'] == 1
            # Historical batch keeps its original day; later settlements do not charge today.
            db.execute("update chat_image_requests set day_start=day_start-interval '1 day' where request_id=%s", (row,))
            assert call('chat_image_quota_get', user)['global']['used'] == 0
            row2 = uuid.uuid4()
            assert call('chat_image_begin', user, row2, model, 2, digest, Jsonb({}))['allowed']
            assert call('chat_image_claim', user, row2, 0, digest)['allowed']
            db.execute("update chat_image_slots set expires_at=clock_timestamp()-interval '1 second' where request_id=%s", (row2,))
            assert call('chat_image_quota_get', user)['global']['used'] == 1
            statuses = db.execute('select status from chat_image_slots where request_id=%s order by slot', (row2,)).fetchall()
            assert statuses == [('uncertain',), ('cancelled',)]
            assert not call('chat_image_finish', user, row2, 0, 'failed', 0, None, None)['allowed']
            stats = call('chat_image_admin_get', actor, None, 1, 20, None, None)
            assert stats['total_images'] == 1 and stats['total'] == 4
            # A queued reservation cannot be dispatched after its accounting day;
            # an already dispatched slot stays attached to its original day.
            rollover = uuid.uuid4()
            assert call('chat_image_begin', user, rollover, model, 2, digest, Jsonb({}))['allowed']
            assert call('chat_image_claim', user, rollover, 0, digest)['allowed']
            assert call('chat_image_dispatch', user, rollover, 0)['allowed']
            db.execute("update chat_image_requests set day_start=day_start-interval '1 day' where request_id=%s", (rollover,))
            assert not call('chat_image_claim', user, rollover, 1, digest)['allowed']
            statuses = db.execute('select status from chat_image_slots where request_id=%s order by slot', (rollover,)).fetchall()
            assert statuses == [('dispatched',), ('cancelled',)]
            assert call('chat_image_finish', user, rollover, 0, 'succeeded', 1, None, False)['allowed']
            assert call('chat_image_finish', user, rollover, 0, 'succeeded', 1, None, False)['allowed']
            assert not call('chat_image_finish', user, rollover, 0, 'failed', 0, None, False)['allowed']
            assert call('chat_image_quota_get', user)['global']['used'] == 1
            print('Image SQL integration tests passed')
    finally:
        if created_db:
            admin.execute(sql.SQL('drop database {} with (force)').format(sql.Identifier(name)))
        for role in reversed(created_roles):
            admin.execute(sql.SQL('drop role {}').format(sql.Identifier(role)))
        admin.close()


if __name__ == '__main__':
    main()
