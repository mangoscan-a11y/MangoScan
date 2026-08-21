-- MangoScan RLS Policies
-- Migration 007: RLS for the new classification reference tables

alter table ripeness_levels enable row level security;
alter table size_grades     enable row level security;

-- ============================================================
-- RIPENESS LEVELS
-- ============================================================

create policy "ripeness_levels_auth_all"
  on ripeness_levels for all
  to authenticated
  using (true)
  with check (true);

create policy "ripeness_levels_service_all"
  on ripeness_levels for all
  to service_role
  using (true) with check (true);

-- ============================================================
-- SIZE GRADES
-- ============================================================

create policy "size_grades_auth_all"
  on size_grades for all
  to authenticated
  using (true)
  with check (true);

create policy "size_grades_service_all"
  on size_grades for all
  to service_role
  using (true) with check (true);
