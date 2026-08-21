/**
 * MangoScan Scan Simulator
 *
 * Inserts fake scan_sessions, scan_images, detection_result, and sorting_logs
 * into Supabase every few seconds, standing in for the ESP32 + YOLOv8 pipeline.
 *
 * Usage: npm run simulator
 * Requires: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'

// Load .env from project root
const envPath = path.resolve(process.cwd(), '.env')
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath })
} else {
  console.warn('No .env file found — make sure env vars are set.')
}

const supabaseUrl = process.env.VITE_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error('ERROR: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in .env')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
})

interface VarietyRow { variety_id: number; variety_name: string }
interface DiseaseRow { disease_id: number; disease_name: string }
interface RipenessRow { ripeness_id: number; ripeness_name: string }
interface SizeRow { size_id: number; size_name: string }

function randomBetween(min: number, max: number) {
  return Math.random() * (max - min) + min
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

let scanCount = 0

/**
 * Reference data (varieties, diseases, ripeness levels, size grades) is
 * loaded from the DB rather than hardcoded, so the simulator automatically
 * picks up new rows (e.g. a 7th variety) without a code change.
 */
async function loadReferenceData() {
  const [varietiesRes, diseasesRes, ripenessRes, sizesRes] = await Promise.all([
    supabase.from('mango_varieties').select('variety_id, variety_name').order('variety_id'),
    supabase.from('diseases').select('disease_id, disease_name').order('disease_id'),
    supabase.from('ripeness_levels').select('ripeness_id, ripeness_name').order('sort_order'),
    supabase.from('size_grades').select('size_id, size_name').order('sort_order'),
  ])

  if (varietiesRes.error) throw varietiesRes.error
  if (diseasesRes.error) throw diseasesRes.error
  if (ripenessRes.error) throw ripenessRes.error
  if (sizesRes.error) throw sizesRes.error

  const varieties = (varietiesRes.data ?? []) as VarietyRow[]
  const diseases = (diseasesRes.data ?? []) as DiseaseRow[]
  const ripenessLevels = (ripenessRes.data ?? []) as RipenessRow[]
  const sizeGrades = (sizesRes.data ?? []) as SizeRow[]

  if (varieties.length === 0 || diseases.length === 0) {
    throw new Error('mango_varieties or diseases is empty — run the migrations and seed.sql first.')
  }
  if (ripenessLevels.length === 0 || sizeGrades.length === 0) {
    throw new Error('ripeness_levels or size_grades is empty — run migration 006 and seed.sql first.')
  }

  const healthy = diseases.find((d) => d.disease_name === 'Healthy') ?? diseases[0]
  const unhealthy = diseases.filter((d) => d.disease_id !== healthy.disease_id)

  return { varieties, healthy, unhealthy, ripenessLevels, sizeGrades }
}

type ReferenceData = Awaited<ReturnType<typeof loadReferenceData>>

async function runOneScan(ref: ReferenceData) {
  scanCount++
  const variety = pick(ref.varieties)
  const ripeness = pick(ref.ripenessLevels)
  const size = pick(ref.sizeGrades)
  const bruised = Math.random() < 0.25

  // 70% healthy, 30% diseased
  const disease = ref.unhealthy.length === 0 || Math.random() < 0.7 ? ref.healthy : pick(ref.unhealthy)

  const verdict = disease.disease_id === ref.healthy.disease_id && !bruised ? 'passed' : 'rejected'
  const confidence = parseFloat(randomBetween(75, 98).toFixed(2))
  const processingTime = parseFloat(randomBetween(1.2, 3.8).toFixed(2))
  const bruiseConfidence = parseFloat((bruised ? randomBetween(70, 98) : randomBetween(5, 25)).toFixed(2))
  const binAssigned = verdict === 'passed' ? `${variety.variety_name} Lane` : 'Rejected Lane'

  // 1. Insert scan_session
  const { data: session, error: sessionErr } = await supabase
    .from('scan_sessions')
    .insert({
      variety_id: variety.variety_id,
      disease_id: disease.disease_id,
      ripeness_id: ripeness.ripeness_id,
      size_id: size.size_id,
      is_bruised: bruised,
      bruise_confidence: bruiseConfidence,
      quality_verdict: verdict,
      confidence_score: confidence,
      processing_time: processingTime,
      bin_assigned: binAssigned,
    })
    .select('scan_id')
    .single()

  if (sessionErr || !session) {
    console.error('Failed to insert scan_session:', sessionErr?.message)
    return
  }

  const scanId = session.scan_id

  // 2. Insert 5 scan_images (placeholder paths)
  const imageRows = Array.from({ length: 5 }, (_, i) => ({
    scan_id: scanId,
    image_path: `placeholders/mango-angle-${i + 1}.jpg`,
    angle_sequence: i + 1,
  }))

  const { data: images } = await supabase.from('scan_images').insert(imageRows).select('image_id')
  const imageIds = images?.map((img: { image_id: number }) => img.image_id) ?? []

  // 3. Insert detection_results — one row per classification dimension
  await supabase.from('detection_result').insert([
    {
      scan_id: scanId,
      image_id: imageIds[0] ?? null,
      detected_class: variety.variety_name,
      class_type: 'variety',
      confidence: parseFloat(randomBetween(78, 98).toFixed(2)),
      bbox_x: 20, bbox_y: 30, bbox_w: 200, bbox_h: 180,
    },
    {
      scan_id: scanId,
      image_id: imageIds[1] ?? null,
      detected_class: disease.disease_name,
      class_type: 'disease',
      confidence: parseFloat(randomBetween(72, 97).toFixed(2)),
      bbox_x: 25, bbox_y: 35, bbox_w: 190, bbox_h: 170,
    },
    {
      scan_id: scanId,
      image_id: imageIds[2] ?? null,
      detected_class: bruised ? 'Bruised' : 'Not Bruised',
      class_type: 'bruise',
      confidence: bruiseConfidence,
      bbox_x: 30, bbox_y: 40, bbox_w: 180, bbox_h: 160,
    },
    {
      scan_id: scanId,
      image_id: imageIds[3] ?? null,
      detected_class: ripeness.ripeness_name,
      class_type: 'color',
      confidence: parseFloat(randomBetween(75, 98).toFixed(2)),
      bbox_x: 15, bbox_y: 20, bbox_w: 210, bbox_h: 190,
    },
    {
      scan_id: scanId,
      image_id: imageIds[4] ?? null,
      detected_class: size.size_name,
      class_type: 'size',
      confidence: parseFloat(randomBetween(75, 98).toFixed(2)),
      bbox_x: 10, bbox_y: 15, bbox_w: 220, bbox_h: 200,
    },
  ])

  // 4. Insert sorting_log
  const servo1 = verdict === 'rejected' ? 'CLOSE' : 'OPEN'
  const servo2 = verdict === 'rejected' ? 'CENTER' : 'ROUTE'
  const latency = Math.floor(randomBetween(80, 200))

  await supabase.from('sorting_logs').insert({
    scan_id: scanId,
    servo1_action: servo1,
    servo2_action: servo2,
    gate_target: binAssigned,
    actuation_status: 'success',
    latency_ms: latency,
  })

  const icon = verdict === 'passed' ? '✓' : '✗'
  console.log(
    `[${new Date().toLocaleTimeString()}] Scan #${scanId} — ${icon} ${verdict.toUpperCase()} | ` +
    `${variety.variety_name} / ${disease.disease_name} / ${bruised ? 'Bruised' : 'Not Bruised'} / ` +
    `${ripeness.ripeness_name} / ${size.size_name} | ${confidence}% confidence | ${processingTime}s | ${binAssigned}`
  )
}

async function main() {
  const INTERVAL_MS = 5000

  console.log('MangoScan Simulator started.')
  console.log(`Inserting one scan every ${INTERVAL_MS / 1000}s. Press Ctrl+C to stop.\n`)

  const ref = await loadReferenceData()
  console.log(
    `Loaded ${ref.varieties.length} varieties, ${ref.unhealthy.length + 1} diseases, ` +
    `${ref.ripenessLevels.length} ripeness levels, ${ref.sizeGrades.length} size grades.\n`
  )

  await runOneScan(ref)

  setInterval(async () => {
    await runOneScan(ref)
  }, INTERVAL_MS)
}

main().catch((err) => {
  console.error('Simulator crashed:', err)
  process.exit(1)
})
