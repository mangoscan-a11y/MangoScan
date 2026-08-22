-- MangoScan RLS Policies
-- Migration 008: Public (unauthenticated) read access
--
-- The web app no longer has a login flow — operators and admins see the
-- dashboard immediately. Requests now hit Supabase as the `anon` role, so
-- every table the dashboard reads needs an anon-read policy. These are
-- added ALONGSIDE the existing `authenticated`-role policies (left
-- unchanged, now simply unreachable) rather than replacing them. Writes
-- stay service_role-only — untouched.
--
-- `daily_summary` is intentionally excluded: the web app only ever reads
-- the `v_daily_summary` view, never that table directly.

create policy "profiles_anon_read"
  on profiles for select
  to anon
  using (true);

create policy "varieties_anon_read"
  on mango_varieties for select
  to anon
  using (true);

create policy "diseases_anon_read"
  on diseases for select
  to anon
  using (true);

create policy "ripeness_levels_anon_read"
  on ripeness_levels for select
  to anon
  using (true);

create policy "size_grades_anon_read"
  on size_grades for select
  to anon
  using (true);

create policy "scans_anon_read"
  on scan_sessions for select
  to anon
  using (true);

create policy "scan_images_anon_read"
  on scan_images for select
  to anon
  using (true);

create policy "detection_result_anon_read"
  on detection_result for select
  to anon
  using (true);

create policy "sorting_logs_anon_read"
  on sorting_logs for select
  to anon
  using (true);
