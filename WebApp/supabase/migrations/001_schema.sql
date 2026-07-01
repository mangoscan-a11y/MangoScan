-- MangoScan Database Schema
-- Migration 001: Enums, tables, views

-- ============================================================
-- ENUMS
-- ============================================================

create type user_status as enum ('active', 'inactive');
create type quality_verdict as enum ('passed', 'rejected');
create type class_type as enum ('variety', 'disease');
create type actuation_status as enum ('success', 'failed');
create type severity_level as enum ('none', 'low', 'moderate', 'high');

-- ============================================================
-- PROFILES (replaces users — keyed to auth.users)
-- ============================================================

create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    varchar(50)  unique not null,
  full_name   varchar(100) not null,
  email       varchar(100),
  status      user_status  not null default 'active',
  created_at  timestamptz  not null default now(),
  last_login  timestamptz
);

-- ============================================================
-- MANGO VARIETIES
-- ============================================================

create table mango_varieties (
  variety_id   bigint generated always as identity primary key,
  variety_name varchar(50)    unique not null,
  description  text,
  market_price decimal(8, 2)
);

-- ============================================================
-- DISEASES
-- ============================================================

create table diseases (
  disease_id   bigint generated always as identity primary key,
  disease_name varchar(50)    unique not null,
  description  text,
  severity_level severity_level not null default 'none'
);

-- ============================================================
-- SCAN SESSIONS
-- ============================================================

create table scan_sessions (
  scan_id          bigint generated always as identity primary key,
  user_id          uuid         references profiles(id) on delete set null,
  variety_id       bigint       references mango_varieties(variety_id) on delete set null,
  disease_id       bigint       references diseases(disease_id) on delete set null,
  quality_verdict  quality_verdict not null,
  confidence_score decimal(5, 2),
  processing_time  decimal(5, 2),
  bin_assigned     varchar(30),
  scan_datetime    timestamptz  not null default now()
);

-- ============================================================
-- SCAN IMAGES
-- ============================================================

create table scan_images (
  image_id       bigint generated always as identity primary key,
  scan_id        bigint       not null references scan_sessions(scan_id) on delete cascade,
  image_path     varchar(255) not null,
  angle_sequence smallint     not null check (angle_sequence between 1 and 5),
  captured_at    timestamptz  not null default now()
);

-- ============================================================
-- DETECTION RESULTS
-- ============================================================

create table detection_result (
  result_id      bigint generated always as identity primary key,
  scan_id        bigint       not null references scan_sessions(scan_id) on delete cascade,
  image_id       bigint       references scan_images(image_id) on delete set null,
  detected_class varchar(50)  not null,
  class_type     class_type   not null,
  confidence     decimal(5, 2) not null,
  bbox_x         int,
  bbox_y         int,
  bbox_w         int,
  bbox_h         int
);

-- ============================================================
-- SORTING LOGS
-- ============================================================

create table sorting_logs (
  log_id           bigint generated always as identity primary key,
  scan_id          bigint       not null references scan_sessions(scan_id) on delete cascade,
  servo1_action    varchar(30),
  servo2_action    varchar(30),
  gate_target      varchar(30),
  actuation_status actuation_status not null,
  latency_ms       int,
  logged_at        timestamptz  not null default now()
);

-- ============================================================
-- DAILY SUMMARY (pre-aggregated, maintained by trigger)
-- ============================================================

create table daily_summary (
  summary_id    bigint generated always as identity primary key,
  summary_date  date    unique not null,
  total_scanned int     not null default 0,
  total_passed  int     not null default 0,
  total_rejected int    not null default 0,
  carabao_count int     not null default 0,
  indian_count  int     not null default 0,
  apple_count   int     not null default 0
);

-- ============================================================
-- VIEW: v_daily_summary (live aggregation from scan_sessions)
-- Used by the web app for charts; daily_summary used by pipeline
-- ============================================================

create view v_daily_summary as
select
  date_trunc('day', s.scan_datetime at time zone 'Asia/Manila')::date as summary_date,
  count(*)                                                             as total_scanned,
  count(*) filter (where s.quality_verdict = 'passed')                as total_passed,
  count(*) filter (where s.quality_verdict = 'rejected')              as total_rejected,
  count(*) filter (where mv.variety_name = 'Carabao')                 as carabao_count,
  count(*) filter (where mv.variety_name = 'Indian')                  as indian_count,
  count(*) filter (where mv.variety_name = 'Mango Apple')             as apple_count,
  avg(s.confidence_score)                                              as avg_confidence,
  avg(s.processing_time)                                               as avg_processing_time
from scan_sessions s
left join mango_varieties mv on mv.variety_id = s.variety_id
group by 1
order by 1 desc;

-- ============================================================
-- INDEXES
-- ============================================================

create index idx_scan_sessions_scan_datetime on scan_sessions(scan_datetime desc);
create index idx_scan_sessions_verdict        on scan_sessions(quality_verdict);
create index idx_scan_sessions_variety        on scan_sessions(variety_id);
create index idx_scan_sessions_disease        on scan_sessions(disease_id);
create index idx_scan_sessions_user           on scan_sessions(user_id);
create index idx_scan_images_scan             on scan_images(scan_id);
create index idx_detection_result_scan        on detection_result(scan_id);
create index idx_sorting_logs_scan            on sorting_logs(scan_id);
create index idx_daily_summary_date           on daily_summary(summary_date desc);
