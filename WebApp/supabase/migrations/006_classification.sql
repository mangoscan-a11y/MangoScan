-- MangoScan Schema
-- Migration 006: Five-dimension classification
-- Run AFTER 005_class_type.sql (enum values must be committed first).

-- ============================================================
-- NEW REFERENCE TABLES
-- ============================================================

create table ripeness_levels (
  ripeness_id   bigint generated always as identity primary key,
  ripeness_name varchar(50) unique not null,
  description   text,
  sort_order    smallint    not null default 0
);

create table size_grades (
  size_id     bigint generated always as identity primary key,
  size_name   varchar(50) unique not null,
  description text,
  min_grams   int,
  max_grams   int,
  sort_order  smallint    not null default 0
);

-- ============================================================
-- SCAN SESSIONS: new classification columns
-- ============================================================

alter table scan_sessions
  add column ripeness_id      bigint references ripeness_levels(ripeness_id) on delete set null,
  add column size_id          bigint references size_grades(size_id)         on delete set null,
  add column is_bruised       boolean,
  add column bruise_confidence decimal(5, 2);

create index idx_scan_sessions_ripeness on scan_sessions(ripeness_id);
create index idx_scan_sessions_size     on scan_sessions(size_id);

-- ============================================================
-- MANGO VARIETIES: rename + add the 3 new varieties
-- (mango_varieties already holds Carabao / Indian / Mango Apple
--  on any instance that previously ran 001_schema.sql + seed.sql)
-- ============================================================

update mango_varieties
   set variety_name = 'Apple Mango'
 where variety_name = 'Mango Apple';

insert into mango_varieties (variety_name, description, market_price) values
  ('Chupadera', 'Small, sweet "sucking" mango variety — skin is pierced and pulp is sucked out rather than sliced.', 60.00),
  ('Wani',      'Local variety with a distinct aromatic flavor, moderate fiber content.',                          70.00),
  ('Kabayo',    'Larger, elongated variety with firm flesh, mildly sweet.',                                        65.00)
on conflict (variety_name) do nothing;

-- ============================================================
-- DAILY SUMMARY: drop the hardcoded per-variety columns
-- ============================================================

drop view if exists v_daily_summary;

alter table daily_summary
  drop column carabao_count,
  drop column indian_count,
  drop column apple_count;

-- ============================================================
-- VIEW: v_daily_summary (totals + averages only — variety
-- breakdown now comes from v_daily_classification)
-- ============================================================

create view v_daily_summary as
select
  date_trunc('day', s.scan_datetime at time zone 'Asia/Manila')::date as summary_date,
  count(*)                                                             as total_scanned,
  count(*) filter (where s.quality_verdict = 'passed')                as total_passed,
  count(*) filter (where s.quality_verdict = 'rejected')              as total_rejected,
  avg(s.confidence_score)                                              as avg_confidence,
  avg(s.processing_time)                                               as avg_processing_time
from scan_sessions s
group by 1
order by 1 desc;

-- ============================================================
-- VIEW: v_daily_classification (long format — one row per
-- day x dimension x label. Feeds every distribution chart.
-- Adding a variety/ripeness level/size grade needs no change
-- here — it is picked up automatically via the reference joins.)
-- ============================================================

create view v_daily_classification as
with base as (
  select
    date_trunc('day', s.scan_datetime at time zone 'Asia/Manila')::date as summary_date,
    mv.variety_name,
    d.disease_name,
    r.ripeness_name,
    r.sort_order as ripeness_sort,
    sg.size_name,
    sg.sort_order as size_sort,
    s.is_bruised
  from scan_sessions s
  left join mango_varieties  mv on mv.variety_id  = s.variety_id
  left join diseases         d  on d.disease_id   = s.disease_id
  left join ripeness_levels  r  on r.ripeness_id  = s.ripeness_id
  left join size_grades      sg on sg.size_id     = s.size_id
)
select summary_date, 'variety'::text as dimension, coalesce(variety_name, 'Unknown') as label,
       count(*)::int as count, 0::smallint as sort_order
  from base group by 1, 3
union all
select summary_date, 'disease', coalesce(disease_name, 'Unknown'),
       count(*)::int, 0::smallint
  from base group by 1, 3
union all
select summary_date, 'bruise',
       case when is_bruised is true then 'Bruised'
            when is_bruised is false then 'Not Bruised'
            else 'Unknown' end,
       count(*)::int,
       (case when is_bruised is true then 1 when is_bruised is false then 0 else 2 end)::smallint
  from base group by 1, 3, 5
union all
select summary_date, 'color', coalesce(ripeness_name, 'Unknown'),
       count(*)::int, coalesce(ripeness_sort, 99)::smallint
  from base group by 1, 3, ripeness_sort
union all
select summary_date, 'size', coalesce(size_name, 'Unknown'),
       count(*)::int, coalesce(size_sort, 99)::smallint
  from base group by 1, 3, size_sort;
