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
            # Removing dynamic admin immediately removes write permission.
            db.execute("delete from club_super_admins where user_id=%s", (actor,))
            rejected(lambda: save(alice))
            print("PASS: migration rerun, validation, directory, RLS/grants, quotas, refunds, expiry, UTC, concurrency, idempotent settlement")
    finally:
        if created_database:
            admin.execute("select pg_terminate_backend(pid) from pg_stat_activity where datname=%s and pid<>pg_backend_pid()", (database,))
            admin.execute(sql.SQL("drop database {}").format(sql.Identifier(database)))
        for role in reversed(created_roles):
            admin.execute(sql.SQL("drop role {}").format(sql.Identifier(role)))
        admin.close()


if __name__ == "__main__":
    main()
