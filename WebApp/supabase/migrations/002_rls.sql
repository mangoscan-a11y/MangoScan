-- MangoScan RLS Policies
-- Migration 002: Row Level Security (single general role — all authenticated users have full access)

-- ============================================================
-- ENABLE RLS ON ALL TABLES
-- ============================================================

alter table profiles        enable row level security;
alter table mango_varieties enable row level security;
alter table diseases        enable row level security;
alter table scan_sessions   enable row level security;
alter table scan_images     enable row level security;
alter table detection_result enable row level security;
alter table sorting_logs    enable row level security;
alter table daily_summary   enable row level security;

-- ============================================================
-- PROFILES
-- ============================================================

create policy "profiles_auth_all"
  on profiles for all
  to authenticated
  using (true)
  with check (true);

create policy "profiles_service_all"
  on profiles for all
  to service_role
  using (true)
  with check (true);

-- ============================================================
-- MANGO VARIETIES
-- ============================================================

create policy "varieties_auth_all"
  on mango_varieties for all
  to authenticated
  using (true)
  with check (true);

create policy "varieties_service_all"
  on mango_varieties for all
  to service_role
  using (true) with check (true);

-- ============================================================
-- DISEASES
-- ============================================================

create policy "diseases_auth_all"
  on diseases for all
  to authenticated
  using (true)
  with check (true);

create policy "diseases_service_all"
  on diseases for all
  to service_role
  using (true) with check (true);

-- ============================================================
-- SCAN SESSIONS  (all auth users read; only service_role inserts)
-- ============================================================

create policy "scans_read"
  on scan_sessions for select
  to authenticated
  using (true);

create policy "scans_service_write"
  on scan_sessions for all
  to service_role
  using (true) with check (true);

-- ============================================================
-- SCAN IMAGES
-- ============================================================

create policy "scan_images_read"
  on scan_images for select
  to authenticated
  using (true);

create policy "scan_images_service_write"
  on scan_images for all
  to service_role
  using (true) with check (true);

-- ============================================================
-- DETECTION RESULT
-- ============================================================

create policy "detection_result_read"
  on detection_result for select
  to authenticated
  using (true);

create policy "detection_result_service_write"
  on detection_result for all
  to service_role
  using (true) with check (true);

-- ============================================================
-- SORTING LOGS
-- ============================================================

create policy "sorting_logs_read"
  on sorting_logs for select
  to authenticated
  using (true);

create policy "sorting_logs_service_write"
  on sorting_logs for all
  to service_role
  using (true) with check (true);

-- ============================================================
-- DAILY SUMMARY
-- ============================================================

create policy "daily_summary_read"
  on daily_summary for select
  to authenticated
  using (true);

create policy "daily_summary_service_write"
  on daily_summary for all
  to service_role
  using (true) with check (true);

-- ============================================================
-- STORAGE BUCKET: scan-images
-- Public read so image URLs work in the browser;
-- service_role only for upload.
-- (Run this in Supabase Dashboard → Storage or via API)
-- ============================================================

-- insert into storage.buckets (id, name, public)
-- values ('scan-images', 'scan-images', true)
-- on conflict (id) do nothing;

-- create policy "scan_images_public_read"
--   on storage.objects for select
--   using (bucket_id = 'scan-images');

-- create policy "scan_images_service_upload"
--   on storage.objects for insert
--   to service_role
--   with check (bucket_id = 'scan-images');
