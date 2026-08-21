-- MangoScan Seed Data
-- Run AFTER migrations; creates reference data + sample accounts
-- NOTE: User accounts must first be created via Supabase Auth (Dashboard or signup).
--       Copy the UUIDs from auth.users into the profile inserts below.
-- NOTE: Migration 006 already renames 'Mango Apple' -> 'Apple Mango' and
--       inserts Chupadera / Wani / Kabayo. This file adds the remaining
--       3 varieties so a fresh install ends up with all 6.

-- ============================================================
-- MANGO VARIETIES
-- ============================================================

insert into mango_varieties (variety_name, description, market_price) values
  ('Carabao',     'The premium Philippine mango — sweet, rich, fiber-free flesh. Golden-yellow when ripe.', 120.00),
  ('Indian',      'Smaller, fiber-rich variety with a tartly sweet flavor. Common in local markets.',        75.00),
  ('Apple Mango', 'Round, apple-sized mango with a firm texture and mild sweetness.',                       90.00)
on conflict (variety_name) do nothing;

-- ============================================================
-- DISEASES
-- ============================================================

insert into diseases (disease_name, description, severity_level) values
  ('Healthy',      'No disease detected. Fruit shows no visible lesions, discoloration, or surface defects.',  'none'),
  ('Anthracnose',  'Fungal disease (Colletotrichum gloeosporioides) causing dark, sunken lesions on the skin. Spreads during post-harvest storage.', 'high'),
  ('Mango Scab',   'Fungal disease (Elsinoë mangiferae) causing corky, scab-like raised spots on the skin surface.', 'moderate')
on conflict (disease_name) do nothing;

-- ============================================================
-- RIPENESS LEVELS (Color)
-- ============================================================

insert into ripeness_levels (ripeness_name, description, sort_order) values
  ('Green',    'Unripe — skin is fully green, flesh is firm and starchy.',            1),
  ('Turning',  'Early ripening — green skin showing the first yellow blush.',         2),
  ('Ripe',     'Fully ripe — golden-yellow skin, ready for market.',                  3),
  ('Overripe', 'Past peak ripeness — skin shows wrinkling or dark spots, soft flesh.', 4)
on conflict (ripeness_name) do nothing;

-- ============================================================
-- SIZE GRADES
-- ============================================================

insert into size_grades (size_name, description, min_grams, max_grams, sort_order) values
  ('Small',  'Small-grade fruit, typically undersized for premium export.', 100, 199, 1),
  ('Medium', 'Standard mid-market size grade.',                             200, 349, 2),
  ('Large',  'Large-grade fruit, premium export size.',                     350, 600, 3)
on conflict (size_name) do nothing;

-- ============================================================
-- SAMPLE SCAN SESSIONS + IMAGES + DETECTIONS + LOGS
-- (uses the service-role key path; profiles not required here)
-- ============================================================

-- Insert 30 sample scans spread over the last 7 days
do $$
declare
  v_scan_id bigint;
  v_variety_id bigint;
  v_disease_id bigint;
  v_ripeness_id bigint;
  v_size_id bigint;
  v_bruised boolean;
  v_verdict quality_verdict;
  v_days_ago int;
  i int;
  j int;
  variety_ids bigint[];
  ripeness_ids bigint[];
  size_ids bigint[];
  n_varieties int;
  n_ripeness int;
  n_sizes int;
begin
  select array_agg(variety_id order by variety_id) into variety_ids from mango_varieties;
  select array_agg(ripeness_id order by sort_order) into ripeness_ids from ripeness_levels;
  select array_agg(size_id order by sort_order) into size_ids from size_grades;
  n_varieties := array_length(variety_ids, 1);
  n_ripeness := array_length(ripeness_ids, 1);
  n_sizes := array_length(size_ids, 1);

  for i in 1..30 loop
    -- Rotate through whatever varieties/ripeness levels/sizes actually exist
    v_variety_id  := variety_ids[((i - 1) % n_varieties) + 1];
    v_ripeness_id := ripeness_ids[((i - 1) % n_ripeness) + 1];
    v_size_id     := size_ids[((i - 1) % n_sizes) + 1];
    v_bruised     := (i % 4 = 0); -- ~25% bruised

    -- Healthy 70%, diseased 30%
    if i % 10 < 7 then
      v_disease_id := (select disease_id from diseases where disease_name = 'Healthy');
      v_verdict := 'passed';
    elsif i % 2 = 0 then
      v_disease_id := (select disease_id from diseases where disease_name = 'Anthracnose');
      v_verdict := 'rejected';
    else
      v_disease_id := (select disease_id from diseases where disease_name = 'Mango Scab');
      v_verdict := 'rejected';
    end if;

    -- Bruised fruit is rejected regardless of disease status
    if v_bruised then
      v_verdict := 'rejected';
    end if;

    v_days_ago := (i % 7);

    insert into scan_sessions (
      variety_id, disease_id, ripeness_id, size_id, is_bruised, bruise_confidence,
      quality_verdict, confidence_score, processing_time, bin_assigned, scan_datetime
    )
    values (
      v_variety_id,
      v_disease_id,
      v_ripeness_id,
      v_size_id,
      v_bruised,
      case when v_bruised then round((70 + random() * 28)::numeric, 2) else round((5 + random() * 20)::numeric, 2) end,
      v_verdict,
      round((75 + random() * 24)::numeric, 2),
      round((1.2 + random() * 2.5)::numeric, 2),
      case v_verdict
        when 'rejected' then 'Rejected Lane'
        else (select variety_name || ' Lane' from mango_varieties where variety_id = v_variety_id)
      end,
      now() - (v_days_ago || ' days')::interval - (random() * interval '8 hours')
    )
    returning scan_id into v_scan_id;

    -- 5 images per scan (placeholder paths; replace with real Storage URLs)
    for j in 1..5 loop
      insert into scan_images (scan_id, image_path, angle_sequence, captured_at)
      values (
        v_scan_id,
        'placeholders/mango-angle-' || j || '.jpg',
        j,
        now() - (v_days_ago || ' days')::interval
      );
    end loop;

    -- 5 detection results per scan — one per classification dimension
    insert into detection_result (scan_id, detected_class, class_type, confidence, bbox_x, bbox_y, bbox_w, bbox_h)
    values
      (v_scan_id,
       (select variety_name from mango_varieties where variety_id = v_variety_id),
       'variety',
       round((75 + random() * 24)::numeric, 2),
       20, 30, 200, 180),
      (v_scan_id,
       (select disease_name from diseases where disease_id = v_disease_id),
       'disease',
       round((70 + random() * 28)::numeric, 2),
       25, 35, 190, 170),
      (v_scan_id,
       case when v_bruised then 'Bruised' else 'Not Bruised' end,
       'bruise',
       round((70 + random() * 28)::numeric, 2),
       30, 40, 180, 160),
      (v_scan_id,
       (select ripeness_name from ripeness_levels where ripeness_id = v_ripeness_id),
       'color',
       round((75 + random() * 24)::numeric, 2),
       15, 20, 210, 190),
      (v_scan_id,
       (select size_name from size_grades where size_id = v_size_id),
       'size',
       round((75 + random() * 24)::numeric, 2),
       10, 15, 220, 200);

    -- 1 sorting log per scan
    insert into sorting_logs (scan_id, servo1_action, servo2_action, gate_target, actuation_status, latency_ms)
    values (
      v_scan_id,
      case v_verdict when 'rejected' then 'CLOSE' else 'OPEN' end,
      case v_verdict when 'rejected' then 'CENTER' else 'ROUTE' end,
      case v_verdict
        when 'rejected' then 'Rejected Lane'
        else (select variety_name || ' Lane' from mango_varieties where variety_id = v_variety_id)
      end,
      'success',
      floor(80 + random() * 120)::int
    );
  end loop;
end $$;

-- ============================================================
-- DAILY SUMMARY (backfill from scan_sessions)
-- ============================================================

insert into daily_summary (summary_date, total_scanned, total_passed, total_rejected)
select
  date_trunc('day', s.scan_datetime at time zone 'Asia/Manila')::date,
  count(*),
  count(*) filter (where s.quality_verdict = 'passed'),
  count(*) filter (where s.quality_verdict = 'rejected')
from scan_sessions s
group by 1
on conflict (summary_date) do update set
  total_scanned  = excluded.total_scanned,
  total_passed   = excluded.total_passed,
  total_rejected = excluded.total_rejected;
