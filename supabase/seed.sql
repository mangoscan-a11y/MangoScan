-- MangoScan Seed Data
-- Run AFTER migrations; creates reference data + sample accounts
-- NOTE: User accounts must first be created via Supabase Auth (Dashboard or signup).
--       Copy the UUIDs from auth.users into the profile inserts below.

-- ============================================================
-- MANGO VARIETIES
-- ============================================================

insert into mango_varieties (variety_name, description, market_price) values
  ('Carabao',     'The premium Philippine mango — sweet, rich, fiber-free flesh. Golden-yellow when ripe.', 120.00),
  ('Indian',      'Smaller, fiber-rich variety with a tartly sweet flavor. Common in local markets.',        75.00),
  ('Mango Apple', 'Round, apple-sized mango with a firm texture and mild sweetness.',                       90.00)
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
-- SAMPLE SCAN SESSIONS + IMAGES + DETECTIONS + LOGS
-- (uses the service-role key path; profiles not required here)
-- ============================================================

-- Insert 30 sample scans spread over the last 7 days
do $$
declare
  v_scan_id bigint;
  v_variety_id bigint;
  v_disease_id bigint;
  v_verdict quality_verdict;
  v_days_ago int;
  i int;
  j int;
begin
  for i in 1..30 loop
    -- Rotate variety
    v_variety_id := ((i - 1) % 3) + 1;

    -- Healthy 70%, diseased 30%
    if i % 10 < 7 then
      v_disease_id := 1; -- Healthy
      v_verdict := 'passed';
    elsif i % 2 = 0 then
      v_disease_id := 2; -- Anthracnose
      v_verdict := 'rejected';
    else
      v_disease_id := 3; -- Mango Scab
      v_verdict := 'rejected';
    end if;

    v_days_ago := (i % 7);

    insert into scan_sessions (
      variety_id, disease_id, quality_verdict,
      confidence_score, processing_time, bin_assigned, scan_datetime
    )
    values (
      v_variety_id,
      v_disease_id,
      v_verdict,
      round((75 + random() * 24)::numeric, 2),
      round((1.2 + random() * 2.5)::numeric, 2),
      case v_verdict when 'rejected' then 'Rejected Lane'
                     else (array['Carabao Lane','Indian Lane','Apple Lane'])[v_variety_id] end,
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

    -- 2 detection results per scan
    insert into detection_result (scan_id, detected_class, class_type, confidence, bbox_x, bbox_y, bbox_w, bbox_h)
    values
      (v_scan_id,
       (array['Carabao','Indian','Mango Apple'])[v_variety_id],
       'variety',
       round((75 + random() * 24)::numeric, 2),
       20, 30, 200, 180),
      (v_scan_id,
       (select disease_name from diseases where disease_id = v_disease_id),
       'disease',
       round((70 + random() * 28)::numeric, 2),
       25, 35, 190, 170);

    -- 1 sorting log per scan
    insert into sorting_logs (scan_id, servo1_action, servo2_action, gate_target, actuation_status, latency_ms)
    values (
      v_scan_id,
      case v_verdict when 'rejected' then 'CLOSE' else 'OPEN' end,
      case v_verdict when 'rejected' then 'CENTER'
                     else (array['LEFT','CENTER','RIGHT'])[v_variety_id] end,
      case v_verdict when 'rejected' then 'Rejected Lane'
                     else (array['Carabao Lane','Indian Lane','Apple Lane'])[v_variety_id] end,
      'success',
      floor(80 + random() * 120)::int
    );
  end loop;
end $$;

-- ============================================================
-- DAILY SUMMARY (backfill from scan_sessions)
-- ============================================================

insert into daily_summary (summary_date, total_scanned, total_passed, total_rejected, carabao_count, indian_count, apple_count)
select
  date_trunc('day', s.scan_datetime at time zone 'Asia/Manila')::date,
  count(*),
  count(*) filter (where s.quality_verdict = 'passed'),
  count(*) filter (where s.quality_verdict = 'rejected'),
  count(*) filter (where mv.variety_name = 'Carabao'),
  count(*) filter (where mv.variety_name = 'Indian'),
  count(*) filter (where mv.variety_name = 'Mango Apple')
from scan_sessions s
left join mango_varieties mv on mv.variety_id = s.variety_id
group by 1
on conflict (summary_date) do update set
  total_scanned  = excluded.total_scanned,
  total_passed   = excluded.total_passed,
  total_rejected = excluded.total_rejected,
  carabao_count  = excluded.carabao_count,
  indian_count   = excluded.indian_count,
  apple_count    = excluded.apple_count;
