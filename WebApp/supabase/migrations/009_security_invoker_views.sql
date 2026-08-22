-- MangoScan Schema
-- Migration 009: Fix "Security Definer View" advisories on v_daily_summary
-- and v_daily_classification
--
-- Views created with plain `create view` run with the permissions of the
-- view OWNER (the postgres role used by migrations, which bypasses RLS),
-- not the querying user — Supabase's Security Advisor flags this as
-- "Security Definer View". That means these two views silently ignored
-- RLS on the underlying tables (scan_sessions, mango_varieties, etc.)
-- regardless of who queried them.
--
-- security_invoker = true (Postgres 15+) makes the view enforce RLS as
-- the querying role instead, matching what querying the underlying
-- tables directly would return. No functional change here: migration
-- 008 already grants `anon` the same row access on every table these
-- views read from.

alter view v_daily_summary        set (security_invoker = true);
alter view v_daily_classification set (security_invoker = true);
