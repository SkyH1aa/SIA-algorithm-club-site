#!/usr/bin/env python3
"""Real PostgreSQL integration tests, strictly LOCAL and disposable.

Install: python -m pip install 'psycopg[binary]' pglast
Run: python tools/test-chat-quota-sql.py --dsn 'host=127.0.0.1 port=5432 dbname=postgres user=postgres'
Requires local CREATEDB/CREATEROLE credentials. Never uses project env/secrets.
Creates and drops a random chat_quota_test_* database; never migrates the supplied
DSN's database. --syntax-only needs only pglast, not a PostgreSQL server.
"""
import argparse
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import threading
import uuid

SCHEMA = Path(__file__).resolve().parents[1] / "supabase" / "club-chat-schema.sql"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dsn", help="Explicit local PostgreSQL admin DSN (no environment default)")
    parser.add_argument("--syntax-only", action="store_true")
    args = parser.parse_args()
    from pglast import parse_sql, parse_plpgsql
    source = SCHEMA.read_text(encoding="utf-8")
    print(f"pglast: {len(parse_sql(source))} statements parsed")
    print(f"PL/pgSQL: {len(parse_plpgsql(source))} functions parsed")
    if args.syntax_only:
        return
    if not args.dsn:
        parser.error("--dsn is required for integration; use --syntax-only for parser validation")
    import psycopg
    from psycopg import sql
    from psycopg.conninfo import conninfo_to_dict, make_conninfo
    from psycopg.types.json import Jsonb

    params = conninfo_to_dict(args.dsn)
    # Reject host lists, DNS names (including localhost), service indirection,
    # remote hostaddr overrides, and Unix-socket paths outside /tmp.
    if params.get("host") not in ("127.0.0.1", "::1", "/tmp"):
        parser.error("host must explicitly be 127.0.0.1, ::1, or /tmp; no remote/DNS DSNs")
    if params.get("hostaddr") not in (None, "127.0.0.1", "::1") or "service" in params:
        parser.error("remote hostaddr/service indirection is forbidden")
    # Never inherit a libpq service, hostaddr or password from the user's
    # environment. The explicit DSN must contain every connection parameter.
    for key in list(os.environ):
        if key.startswith("PG"):
            os.environ.pop(key)
    if "passfile" not in params:
        params["passfile"] = os.devnull
    local_dsn = make_conninfo(**params)
    database = "chat_quota_test_" + uuid.uuid4().hex
    admin = psycopg.connect(local_dsn, autocommit=True)
    created_roles = []
    created_database = False
    try:
        # Roles are cluster objects; only clean up ones this test created.
        for role in ("anon", "authenticated", "service_role"):
            if not admin.execute("select 1 from pg_roles where rolname=%s", (role,)).fetchone():
                admin.execute(sql.SQL("create role {} nologin").format(sql.Identifier(role)))
                created_roles.append(role)
        admin.execute(sql.SQL("create database {}").format(sql.Identifier(database)))
        created_database = True
        test_dsn = make_conninfo(local_dsn, dbname=database)

        def connect():
            return psycopg.connect(test_dsn, autocommit=True)

        with connect() as db:
            db.execute("create schema auth; create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb)")
            db.execute("create table public.club_super_admins(user_id uuid primary key references auth.users(id))")
            db.execute("create table public.club_member_profiles(user_id uuid primary key references auth.users(id), username text, member_name text)")
            db.execute(source)
            legacy_provider = db.execute("insert into chat_providers(name,base_url,secret_name) values ('legacy-protocol','https://invalid.local/v1/messages','CHAT_KEY_TEST') returning id").fetchone()[0]
            legacy_model = db.execute("insert into chat_models(provider_id,model_key,display_name,context_window,max_output_tokens,default_max_output_tokens,reasoning_efforts,default_reasoning_effort) values (%s,'legacy-thinking','Legacy thinking',8192,4096,2048,'[\"low\"]'::jsonb,'low') returning id", (legacy_provider,)).fetchone()[0]
            db.execute("alter table chat_models drop column claude_thinking")
            db.execute(source)
            assert db.execute("select claude_thinking,reasoning_efforts,default_reasoning_effort from chat_models where id=%s", (legacy_model,)).fetchone() == ({"mode": "omit"}, ["low"], "low")
            db.execute("update chat_models set claude_thinking=%s where id=%s", (Jsonb({"mode": "adaptive", "efforts": ["medium", "max"], "default_effort": "medium"}), legacy_model))
            db.execute(source)
            assert db.execute("select claude_thinking from chat_models where id=%s", (legacy_model,)).fetchone()[0] == {"mode": "adaptive", "efforts": ["medium", "max"], "default_effort": "medium"}
            for config in ({"mode": "omit"}, {"mode": "disabled"}, {"mode": "enabled", "budget_tokens": 1024}, {"mode": "adaptive"}, {"mode": "adaptive", "efforts": [], "default_effort": None}, {"mode": "adaptive", "efforts": ["low", "medium", "high", "xhigh", "max"], "default_effort": "max"}):
                db.execute("update chat_models set claude_thinking=%s where id=%s", (Jsonb(config), legacy_model))
            for config in (None, [], "adaptive", {}, {"mode": "legacy"}, {"mode": "omit", "budget_tokens": 1024}, {"mode": "disabled", "efforts": []}, {"mode": "enabled"}, {"mode": "enabled", "budget_tokens": "1024"}, {"mode": "enabled", "budget_tokens": 1023}, {"mode": "enabled", "budget_tokens": 1024.5}, {"mode": "enabled", "budget_tokens": 2048}, {"mode": "enabled", "budget_tokens": 1024, "default_effort": None}, {"mode": "adaptive", "budget_tokens": 1024}, {"mode": "adaptive", "efforts": None}, {"mode": "adaptive", "efforts": "low"}, {"mode": "adaptive", "efforts": ["none"]}, {"mode": "adaptive", "efforts": [1]}, {"mode": "adaptive", "efforts": ["low"], "default_effort": "high"}, {"mode": "adaptive", "unknown": True}):
                try:
                    db.execute("update chat_models set claude_thinking=%s where id=%s", (Jsonb(config), legacy_model))
                except psycopg.IntegrityError:
                    pass
                else:
                    raise AssertionError(f"Invalid Claude thinking configuration accepted: {config!r}")
            db.execute("update chat_models set claude_thinking=%s where id=%s", (Jsonb({"mode": "enabled", "budget_tokens": 1024}), legacy_model))
            try:
                db.execute("update chat_models set default_max_output_tokens=1024 where id=%s", (legacy_model,))
            except psycopg.IntegrityError:
                pass
            else:
                raise AssertionError("Default output cannot shrink to the manual thinking budget")
            db.execute("alter table chat_providers drop column api_protocol")
            db.execute(source)  # Upgrade an installed schema without the protocol column.
            assert db.execute("select api_protocol,base_url from chat_providers where id=%s", (legacy_provider,)).fetchone() == ("auto", "https://invalid.local/v1/messages")
            db.execute("update chat_providers set api_protocol='chat' where id=%s", (legacy_provider,))
            db.execute(source)  # Migration must rerun without resetting explicit selections.
            assert db.execute("select api_protocol from chat_providers where id=%s", (legacy_provider,)).fetchone()[0] == "chat"
            for protocol in ("auto", "responses", "messages", "chat"):
                db.execute("update chat_providers set api_protocol=%s where id=%s", (protocol, legacy_provider))
            for protocol in ("unknown", "", "chat_completions", None):
                try:
                    db.execute("update chat_providers set api_protocol=%s where id=%s", (protocol, legacy_provider))
                except psycopg.IntegrityError:
                    pass
                else:
                    raise AssertionError("Invalid provider API protocol accepted")
            actor, alice, bob, unbound = [uuid.uuid4() for _ in range(4)]
            for uid in (actor, alice, bob, unbound):
                db.execute("insert into auth.users(id,email) values (%s,%s)", (uid, str(uid) + "@test.local"))
            db.execute("insert into club_super_admins values (%s)", (actor,))
            db.execute("insert into club_member_profiles values (%s,'alice','Alice')", (alice,))
            provider = db.execute("insert into chat_providers(name,base_url,secret_name) values ('test','https://invalid.local','CHAT_KEY_TEST') returning id").fetchone()[0]
            model = db.execute("insert into chat_models(provider_id,model_key,display_name,context_window,max_output_tokens,default_max_output_tokens) values (%s,'test','Test',4096,1024,128) returning id", (provider,)).fetchone()[0]
            audit = dict(member_name="Alice", username="alice", provider_name="test", model_name="Test", action="respond", provider_id=str(provider), model_id=str(model), model_key="test", input_bytes=12, max_output_tokens=128, reasoning_effort=None, status="audited")

            def rpc(name, *values, conn=db):
                query = sql.SQL("select public.{}({})").format(sql.Identifier(name), sql.SQL(",").join(sql.Placeholder() for _ in values))
                return conn.execute(query, values).fetchone()[0]

            def quota(uid=alice):
                return rpc("chat_quota_get", uid)

            def save(uid, daily=None, weekly=None, monthly=None):
                snap = quota(uid)
                version = snap["global" if uid is None else "user"]["version"]
                return rpc("chat_quota_save", actor, uid, daily, weekly, monthly, version)

            def begin(uid=alice, inp=10, out=30, request=None, conn=db):
                request = request or uuid.uuid4()
                result = rpc("chat_begin_generation", uid, request, inp, out, Jsonb(audit), conn=conn)
                return request, result

            def finish(request, patch=None, refund=False):
                return rpc("chat_finish_generation", request, Jsonb(patch or {"status": "failed"}), refund)

            def rejected(callback):
                try:
                    callback()
                except psycopg.Error:
                    return
                raise AssertionError("Expected PostgreSQL rejection")

            snap = quota()
            assert snap["global"]["daily_limit"] is None and snap["user"]["version"] == 0
            assert [p["period"] for p in snap["periods"]] == ["day", "week", "month"]
            assert all(p["remaining"] is None for p in snap["periods"])
            rejected(lambda: rpc("chat_quota_get", uuid.uuid4()))
            rejected(lambda: rpc("chat_quota_save", bob, alice, 100, None, None, 0))
            rejected(lambda: rpc("chat_quota_save", actor, alice, -1, None, None, 0))
            rejected(lambda: rpc("chat_quota_save", actor, alice, 1000000000001, None, None, 0))
            assert rpc("chat_quota_save", actor, alice, 100, None, None, 99) == {"code": "conflict"}
            assert save(alice, 1000000000000)["user"]["daily_limit"] == 1000000000000
            assert set(quota()["global"]) == {"daily_limit", "version", "used", "remaining", "resets_at"}
            assert set(quota()["user"]) == {"daily_limit", "weekly_limit", "monthly_limit", "version"}
            user_metadata = db.execute("select updated_by,updated_at from chat_quota_users where user_id=%s", (alice,)).fetchone()
            assert user_metadata[0] == actor and user_metadata[1] is not None
            assert rpc("chat_quota_save", actor, alice, 99, None, None, 0) == {"code": "conflict"}
            assert db.execute("select updated_by,updated_at from chat_quota_users where user_id=%s", (alice,)).fetchone() == user_metadata
            save(None)
            global_metadata = db.execute("select updated_by,updated_at from chat_quota_global where singleton").fetchone()
            assert global_metadata[0] == actor and global_metadata[1] is not None
            rejected(lambda: rpc("chat_blacklist_set", actor, alice, True, "x" * 1001))
            rejected(lambda: rpc("chat_blacklist_set", actor, alice, False, " " * 1001))
            assert rpc("chat_blacklist_set", actor, alice, True, "汉" * 1000)["reason"] == "汉" * 1000
            rejected(lambda: db.execute("update chat_blacklist set reason=%s where user_id=%s", ("x" * 1001, alice)))
            rpc("chat_blacklist_set", actor, alice, False, None)
            directory = rpc("chat_user_directory", actor)
            assert len(directory["users"]) == 4
            assert next(u for u in directory["users"] if u["user_id"] == str(unbound))["bound"] is False
            assert rpc("chat_blacklist_set", actor, alice, True, "test")["blacklisted"]
            assert begin()[1]["code"] == "blacklisted"
            assert rpc("chat_blacklist_set", actor, alice, False, None)["blacklisted"] is False
            save(alice, 0)
            assert begin()[1]["code"] == "quota_exceeded"
            save(alice, 35, 100, 100)
            request, result = begin()
            assert result["allowed"] and result["max_output_tokens"] == 25 and result["quota_limited"]
            assert result["quota"]["global"]["used"] == 35
            assert db.execute("select count(*) from chat_quota_allocations where request_id=%s", (request,)).fetchone()[0] == 4
            assert begin()[1]["code"] == "busy"
            assert begin(request=request)[1]["code"] == "duplicate_request"
            snap = finish(request, {"status": "completed", "input_tokens": 10, "output_tokens": 5, "total_tokens": 2})
            assert snap["global"]["used"] == 15
            assert finish(request, {"status": "failed"}, True)["global"]["used"] == 15
            assert db.execute("select total_tokens,status from chat_usage where request_id=%s", (request,)).fetchone() == (15, "completed")
            save(alice)
            request, _ = begin()
            assert finish(request)["global"]["used"] == 55  # Unknown usage retains reservation.
            request, _ = begin()
            assert finish(request, refund=True)["global"]["used"] == 55
            request, _ = begin()
            db.execute("update chat_usage set status='upstream_started' where request_id=%s", (request,))
            rejected(lambda: finish(request, refund=True))
            rejected(lambda: finish(request, {"status": "completed", "total_tokens": -1}))
            finish(request)
            # Lease expiry must neither release quota nor erase allocation, and
            # a late finish must touch old buckets and not a newer request lease.
            old, _ = begin()
            db.execute("update chat_generation_leases set expires_at=clock_timestamp()-interval '1 second' where request_id=%s", (old,))
            before = quota()["global"]["used"]
            new, result = begin()
            assert result["allowed"] and quota()["global"]["used"] == before + 40
            finish(old, {"status": "completed", "input_tokens": 10, "output_tokens": 2})
            assert db.execute("select request_id from chat_generation_leases where user_id=%s", (alice,)).fetchone()[0] == new
            finish(new)
            # UTC calendar independent of session timezone, ISO Monday week.
            db.execute("set timezone='Pacific/Honolulu'")
            snap = quota()
            starts = db.execute("select date_trunc('day',clock_timestamp() at time zone 'UTC'),date_trunc('week',clock_timestamp() at time zone 'UTC'),date_trunc('month',clock_timestamp() at time zone 'UTC')").fetchone()
            from datetime import datetime, timedelta, timezone
            for entry, start in zip(snap["periods"], starts):
                reset = datetime.fromisoformat(entry["resets_at"])
                assert reset.utcoffset() == timedelta(0)  # Snapshot must encode UTC too.
                assert reset > start.replace(tzinfo=timezone.utc)
            db.execute("set timezone='UTC'")
            # Privilege and RLS boundary.
            for role in ("anon", "authenticated"):
                db.execute(sql.SQL("set role {}").format(sql.Identifier(role)))
                rejected(lambda: rpc("chat_quota_get", alice))
                rejected(lambda: db.execute("select * from chat_quota_reservations"))
                db.execute("reset role")
            db.execute("set role service_role")
            assert rpc("chat_quota_get", alice) is not None
            db.execute("reset role")
            # Contending users cannot overbook the same remaining global quota.
            used = quota()["global"]["used"]
            save(None, used + 40)
            barrier = threading.Barrier(2)

            def contender(uid):
                with connect() as connection:
                    barrier.wait(timeout=10)
                    return begin(uid=uid, conn=connection)

            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(contender, (alice, bob)))
            assert sum(result["allowed"] for _, result in results) == 1
            winner = next(request for request, result in results if result["allowed"])
            # Concurrent conflicting terminal patches settle exactly once.
            barrier = threading.Barrier(2)

            def settler(total):
                with connect() as connection:
                    barrier.wait(timeout=10)
                    return rpc("chat_finish_generation", winner, Jsonb({"status": "completed", "input_tokens": 10, "output_tokens": total - 10, "total_tokens": total}), False, conn=connection)

            with ThreadPoolExecutor(max_workers=2) as pool:
                list(pool.map(settler, (15, 20)))
            settled = db.execute("select settled_tokens from chat_quota_reservations where request_id=%s", (winner,)).fetchone()[0]
            assert settled in (15, 20) and quota()["global"]["used"] == used + settled
            # Administrative aggregates are SQL-side, independent of pagination
            # and date filters, and preserve token sums above JS safe integers.
            rejected(lambda: rpc('chat_admin_usage', bob, 1, 50))
            rejected(lambda: rpc('chat_admin_usage', None, 1, 50))
            for page, size, lower, upper in ((0, 50, None, None), (1, 201, None, None), (None, 50, None, None), (1, 50, 'infinity', None), (1, 50, '2026-10-18', '2026-10-17')):
                rejected(lambda: rpc('chat_admin_usage', actor, page, size, lower, upper))
            db.execute("""insert into chat_usage(request_id,user_id,provider_id,model_id,model_key,
                member_name,username,provider_name,model_name,action,input_bytes,max_output_tokens,status,total_tokens,started_at)
              select gen_random_uuid(),%s,%s,%s,'aggregate-test','Alice','alice','test','Test',
                'respond',12,128,'completed',case when i=1 then 9007199254740993
                  when i %% 7=0 then null else i::bigint end,
                clock_timestamp()-interval '10 days' + i * interval '1 second'
              from generate_series(1,1505) i""", (alice, provider, model))
            all_usage = rpc('chat_admin_usage', actor, 1, 2)
            assert all_usage['summary']['total_records'] > 1505 and len(all_usage['usage']) == 2
            assert isinstance(all_usage['summary']['total_tokens'], str)
            assert int(all_usage['summary']['total_tokens']) > 2**53
            expected = db.execute("select count(*),coalesce(sum(total_tokens),0)::text from chat_usage where started_at >= %s and started_at < %s", (all_usage['window_start'], all_usage['window_end'])).fetchone()
            assert all_usage['summary'] == {'total_records': expected[0], 'total_tokens': expected[1]}
            assert all_usage['total'] == expected[0]
            start = datetime.fromisoformat(all_usage['window_start'])
            end = datetime.fromisoformat(all_usage['window_end'])
            assert end-start == timedelta(hours=2160) and start.utcoffset() == timedelta(0)
            # Small pages and >1000 rows prove the aggregate avoids API row caps.
            page_two = rpc('chat_admin_usage', actor, 2, 2)
            assert page_two['summary'] == all_usage['summary']
            assert {r['request_id'] for r in page_two['usage']}.isdisjoint(r['request_id'] for r in all_usage['usage'])
            row_time = db.execute("select min(started_at) from chat_usage where model_key='aggregate-test'").fetchone()[0]
            one = rpc('chat_admin_usage', actor, 1, 50, row_time, row_time)
            assert one['total'] == 1 and len(one['usage']) == 1
            assert one['summary'] == all_usage['summary']
            empty_page = rpc('chat_admin_usage', actor, 100000, 200)
            assert empty_page['usage'] == [] and empty_page['total'] == expected[0]
            past = rpc('chat_admin_usage', actor, 1, 50, '2000-01-01', '2001-01-01')
            assert past['usage'] == [] and past['total'] == 0 and past['summary'] == all_usage['summary']
            safe_fields = {'request_id','user_id','member_name','username','model_key','model_name',
                'provider_name','action','input_bytes','max_output_tokens','reasoning_effort','status',
                'upstream_status','input_tokens','output_tokens','total_tokens','error_code','started_at','finished_at'}
            assert all(set(row) == safe_fields for row in one['usage'])
            assert not any(key in str(one) for key in ('CHAT_KEY_TEST', 'secret_name', 'base_url', 'auth_header'))

            # Retention removes real FK chains without refunds or bucket edits.
            save(None)
            save(alice)
            expired, result = begin()
            assert result['allowed']
            finish(expired, {'status': 'completed', 'input_tokens': 10, 'output_tokens': 5})
            db.execute("update chat_usage set started_at=clock_timestamp()-interval '2161 hours' where request_id=%s", (expired,))
            late, result = begin()
            assert result['allowed']
            db.execute("update chat_usage set started_at=clock_timestamp()-interval '2161 hours',status='upstream_started' where request_id=%s", (late,))
            db.execute("update chat_generation_leases set expires_at=clock_timestamp()-interval '1 second' where request_id=%s", (late,))
            # Terminal audit with an outstanding reservation must remain protected.
            terminal_unsettled, result = begin()
            assert result['allowed']
            db.execute("update chat_usage set started_at=clock_timestamp()-interval '2161 hours',status='failed' where request_id=%s", (terminal_unsettled,))
            db.execute("update chat_generation_leases set expires_at=clock_timestamp()-interval '1 second' where request_id=%s", (terminal_unsettled,))
            live, result = begin()
            assert result['allowed']
            finish(live)
            db.execute("update chat_usage set started_at=clock_timestamp()-interval '2161 hours' where request_id=%s", (live,))
            assert rpc('chat_acquire_generation_lease', alice, live, datetime.now(timezone.utc)+timedelta(hours=1))
            # A newer active lease must survive deletion of another old request.
            db.execute("insert into chat_generation_leases(user_id,request_id,expires_at) values (%s,%s,clock_timestamp()-interval '1 second')", (bob, expired))
            protected_legacy, expired_legacy, unfinished_legacy, inside, outside, future = [uuid.uuid4() for _ in range(6)]
            for request_id, age, status in ((protected_legacy, 2161, 'audited'), (expired_legacy, 2161, 'completed'), (unfinished_legacy, 2161, 'completed'), (inside, 2159.99, 'completed'), (outside, 2160.01, 'completed'), (future, -1, 'completed')):
                db.execute("""insert into chat_usage(request_id,user_id,provider_id,model_id,model_key,
                    action,input_bytes,max_output_tokens,status,started_at,finished_at)
                  values (%s,%s,%s,%s,'retention-test','respond',12,128,%s,clock_timestamp()-%s * interval '1 hour',%s)""", (request_id, alice, provider, model, status, age, None if request_id == unfinished_legacy else datetime.now(timezone.utc)))
            before_buckets = db.execute('select * from chat_quota_buckets order by scope,period,starts_at').fetchall()
            before_global = db.execute('select * from chat_quota_global').fetchall()
            before_users = db.execute('select * from chat_quota_users order by user_id').fetchall()
            original_count = db.execute('select count(*) from chat_usage').fetchone()[0]
            # Read RPC does not perform cleanup (including for a stale date filter).
            clamped = rpc('chat_admin_usage', actor, 1, 200, '2000-01-01', '2099-01-01')
            assert clamped['summary']['total_records'] == clamped['total']
            assert db.execute('select count(*) from chat_usage').fetchone()[0] == original_count
            assert rpc('chat_cleanup_usage') == 3  # settled chain + legacy + outside
            for table in ('chat_usage', 'chat_quota_reservations', 'chat_quota_allocations', 'chat_generation_leases'):
                assert db.execute(sql.SQL('select count(*) from {} where request_id=%s').format(sql.Identifier(table)), (expired,)).fetchone()[0] == 0
            for request_id in (late, terminal_unsettled, live, protected_legacy, unfinished_legacy, inside, future):
                assert db.execute('select 1 from chat_usage where request_id=%s', (request_id,)).fetchone()
            assert db.execute('select request_id from chat_generation_leases where user_id=%s', (alice,)).fetchone()[0] == live
            assert db.execute('select * from chat_quota_buckets order by scope,period,starts_at').fetchall() == before_buckets
            assert db.execute('select * from chat_quota_global').fetchall() == before_global
            assert db.execute('select * from chat_quota_users order by user_id').fetchall() == before_users
            assert rpc('chat_cleanup_usage') == 0
            # Expired lease does not prevent a late settlement or erase its quota.
            finish(late, {'status': 'completed', 'input_tokens': 10, 'output_tokens': 2})
            assert db.execute('select request_id from chat_generation_leases where user_id=%s', (alice,)).fetchone()[0] == live
            assert rpc('chat_cleanup_usage') == 1
            finish(terminal_unsettled)
            assert rpc('chat_cleanup_usage') == 1
            db.execute("update chat_generation_leases set expires_at=clock_timestamp()-interval '1 second' where request_id=%s", (live,))
            assert rpc('chat_cleanup_usage') == 1
            # Batches are bounded and repeated invocation drains without duplicates.
            db.execute("""insert into chat_usage(request_id,user_id,provider_id,model_id,model_key,
                action,input_bytes,max_output_tokens,status,started_at,finished_at)
              select gen_random_uuid(),%s,%s,%s,'batch-test','respond',12,128,'completed',
                clock_timestamp()-interval '2161 hours',clock_timestamp() from generate_series(1,1001)""", (alice, provider, model))
            assert rpc('chat_cleanup_usage') == 1000
            assert rpc('chat_cleanup_usage') == 1 and rpc('chat_cleanup_usage') == 0
            for function in ('chat_cleanup_usage()', 'chat_admin_usage(uuid,integer,integer,timestamp with time zone,timestamp with time zone)'):
                for role in ('anon', 'authenticated'):
                    assert not db.execute('select has_function_privilege(%s,%s,\'EXECUTE\')', (role, function)).fetchone()[0]
                assert db.execute('select has_function_privilege(\'service_role\',%s,\'EXECUTE\')', (function,)).fetchone()[0]
            # Real concurrent sessions: cleanup and a late settlement queue on
            # the same global lock and must leave one settled audit or delete it
            # after settlement; either serial order is valid, quota stays exact.
            race, result = begin()
            assert result['allowed']
            db.execute("update chat_usage set started_at=clock_timestamp()-interval '2161 hours' where request_id=%s", (race,))
            db.execute("update chat_generation_leases set expires_at=clock_timestamp()-interval '1 second' where request_id=%s", (race,))
            race_used = quota()['global']['used']
            barrier = threading.Barrier(2)

            def cleanup_racer(settle):
                with connect() as connection:
                    barrier.wait(timeout=10)
                    if settle:
                        return rpc('chat_finish_generation', race, Jsonb({'status':'completed','input_tokens':10,'output_tokens':2}), False, conn=connection)
                    return rpc('chat_cleanup_usage', conn=connection)

            with ThreadPoolExecutor(max_workers=2) as pool:
                list(pool.map(cleanup_racer, (True, False)))
            assert quota()['global']['used'] == race_used-40+12
            remaining = db.execute('select status,total_tokens from chat_usage where request_id=%s', (race,)).fetchone()
            assert remaining in (None, ('completed', 12))
            rpc('chat_cleanup_usage')
            assert db.execute('select count(*) from chat_usage where request_id=%s', (race,)).fetchone()[0] == 0
            for role in ('anon', 'authenticated'):
                db.execute(sql.SQL('set role {}').format(sql.Identifier(role)))
                rejected(lambda: rpc('chat_cleanup_usage'))
                rejected(lambda: rpc('chat_admin_usage', actor, 1, 50))
                db.execute('reset role')
            db.execute('set role service_role')
            assert rpc('chat_admin_usage', actor, 1, 50)['summary']['total_records'] > 1505
            assert rpc('chat_cleanup_usage') == 0
            db.execute('reset role')
            # Real extension deployments must contain exactly one correct active job.
            if db.execute("select 1 from pg_extension where extname='pg_cron'").fetchone():
                jobs = db.execute("select schedule,command,active from cron.job where jobname='chat-usage-retention-90d'").fetchall()
                assert jobs == [('0 * * * *', 'select public.chat_cleanup_usage();', True)]
                db.execute(source)
                assert db.execute("select schedule,command,active from cron.job where jobname='chat-usage-retention-90d'").fetchall() == jobs
            # Freeze the database clock only inside a rolled-back test transaction
            # so exact microsecond boundaries are deterministic, including DST.
            with db.transaction(force_rollback=True):
                fixed = datetime(2026, 11, 2, 12, tzinfo=timezone.utc)
                literal = sql.Literal(fixed).as_string(db)
                for signature in ('chat_cleanup_usage()', 'chat_admin_usage(uuid,integer,integer,timestamptz,timestamptz)'):
                    definition = db.execute('select pg_get_functiondef(%s::regprocedure)', (signature,)).fetchone()[0]
                    assert 'clock_timestamp()' in definition
                    db.execute(definition.replace('clock_timestamp()', literal))
                cutoff = fixed-timedelta(hours=2160)
                lower, upper, just_old = [uuid.uuid4() for _ in range(3)]
                for request_id, at in ((lower, cutoff), (upper, fixed), (just_old, cutoff-timedelta(microseconds=1))):
                    db.execute("""insert into chat_usage(request_id,user_id,provider_id,model_id,model_key,
                        action,input_bytes,max_output_tokens,status,started_at,finished_at)
                      values (%s,%s,%s,%s,'boundary','respond',12,128,'completed',%s,%s)""", (request_id, alice, provider, model, at, at))
                db.execute("set local timezone='America/New_York'")
                exact = rpc('chat_admin_usage', actor, 1, 50, cutoff, cutoff)
                assert exact['total'] == 1 and exact['usage'][0]['request_id'] == str(lower)
                assert datetime.fromisoformat(exact['window_end']) == fixed
                assert datetime.fromisoformat(exact['window_start']) == cutoff
                assert rpc('chat_admin_usage', actor, 1, 50, fixed, fixed)['total'] == 0
                rpc('chat_cleanup_usage')
                assert db.execute('select 1 from chat_usage where request_id=%s', (just_old,)).fetchone() is None
                assert db.execute('select count(*) from chat_usage where request_id in (%s,%s)', (lower, upper)).fetchone()[0] == 2
            # Empty summaries still return exact typed zeroes and a full window.
            with db.transaction(force_rollback=True):
                db.execute('delete from chat_quota_allocations; delete from chat_quota_reservations; delete from chat_generation_leases; delete from chat_usage')
                empty = rpc('chat_admin_usage', actor, 1, 50)
                assert empty['summary'] == {'total_records': 0, 'total_tokens': '0'}
                assert empty['usage'] == [] and empty['total'] == 0
            # Removing dynamic admin immediately removes both read/write permission.
            db.execute("delete from club_super_admins where user_id=%s", (actor,))
            rejected(lambda: save(alice))
            rejected(lambda: rpc('chat_admin_usage', actor, 1, 50))
            print("PASS: migration rerun, validation, directory, RLS/grants, quotas, refunds, expiry, UTC, concurrency, idempotent settlement, 90-day aggregate/precision/privacy, bounded retention/FKs/protected requests/unchanged quotas/cron")
    finally:
        if created_database:
            admin.execute("select pg_terminate_backend(pid) from pg_stat_activity where datname=%s and pid<>pg_backend_pid()", (database,))
            admin.execute(sql.SQL("drop database {}").format(sql.Identifier(database)))
        for role in reversed(created_roles):
            admin.execute(sql.SQL("drop role {}").format(sql.Identifier(role)))
        admin.close()


if __name__ == "__main__":
    main()
