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

const VARIETIES = [
  { name: 'Carabao', id: 1 },
  { name: 'Indian',  id: 2 },
  { name: 'Mango Apple', id: 3 },
]

const DISEASES = [
  { name: 'Healthy',    id: 1, passed: true },
  { name: 'Anthracnose', id: 2, passed: false },
  { name: 'Mango Scab', id: 3, passed: false },
]

const BINS: Record<string, string[]> = {
  'passed': ['Carabao Lane', 'Indian Lane', 'Apple Lane'],
  'rejected': ['Rejected Lane'],
}

function randomBetween(min: number, max: number) {
  return Math.random() * (max - min) + min
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

let scanCount = 0

async function runOneScan() {
  scanCount++
  const variety = pick(VARIETIES)

  // 70% healthy, 30% diseased
  const diseasePool = Math.random() < 0.7
    ? [DISEASES[0]]
    : [DISEASES[1], DISEASES[2]]
  const disease = pick(diseasePool)

  const verdict = disease.passed ? 'passed' : 'rejected'
  const confidence = parseFloat(randomBetween(75, 98).toFixed(2))
  const processingTime = parseFloat(randomBetween(1.2, 3.8).toFixed(2))
  const binOptions = verdict === 'passed' ? [BINS.passed[variety.id - 1]] : BINS.rejected
  const binAssigned = pick(binOptions)

  // 1. Insert scan_session
  const { data: session, error: sessionErr } = await supabase
    .from('scan_sessions')
    .insert({
      variety_id: variety.id,
      disease_id: disease.id,
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

  // 3. Insert detection_results (variety + disease)
  const imageIds = images?.map((img: { image_id: number }) => img.image_id) ?? [null, null]
  await supabase.from('detection_result').insert([
    {
      scan_id: scanId,
      image_id: imageIds[0] ?? null,
      detected_class: variety.name,
      class_type: 'variety',
      confidence: parseFloat(randomBetween(78, 98).toFixed(2)),
      bbox_x: 20, bbox_y: 30, bbox_w: 200, bbox_h: 180,
    },
    {
      scan_id: scanId,
      image_id: imageIds[1] ?? null,
      detected_class: disease.name,
      class_type: 'disease',
      confidence: parseFloat(randomBetween(72, 97).toFixed(2)),
      bbox_x: 25, bbox_y: 35, bbox_w: 190, bbox_h: 170,
    },
  ])

  // 4. Insert sorting_log
  const servo1 = verdict === 'rejected' ? 'CLOSE' : 'OPEN'
  const servo2Actions = ['LEFT', 'CENTER', 'RIGHT']
  const servo2 = verdict === 'rejected' ? 'CENTER' : servo2Actions[variety.id - 1]
  const latency = Math.floor(randomBetween(80, 200))

  await supabase.from('sorting_logs').insert({
    scan_id: scanId,
    servo1_action: servo1,
    servo2_action: servo2,
    gate_target: binAssigned,
    actuation_status: 'success',
    latency_ms: latency,
  })

  // 5. Update daily_summary (upsert)
  const today = new Date().toISOString().split('T')[0]
  await supabase.rpc('upsert_daily_summary', {
    p_date: today,
    p_variety: variety.name,
    p_verdict: verdict,
  }).then(({ error }) => {
    // RPC may not exist yet — fall back silently
    if (error && !error.message.includes('does not exist')) {
      console.warn('daily_summary upsert warning:', error.message)
    }
  })

  const icon = verdict === 'passed' ? '✓' : '✗'
  console.log(
    `[${new Date().toLocaleTimeString()}] Scan #${scanId} — ${icon} ${verdict.toUpperCase()} | ${variety.name} / ${disease.name} | ${confidence}% confidence | ${processingTime}s | ${binAssigned}`
  )
}

async function main() {
  const INTERVAL_MS = 5000

  console.log('MangoScan Simulator started.')
  console.log(`Inserting one scan every ${INTERVAL_MS / 1000}s. Press Ctrl+C to stop.\n`)

  await runOneScan()

  setInterval(async () => {
    await runOneScan()
  }, INTERVAL_MS)
}

main().catch((err) => {
  console.error('Simulator crashed:', err)
  process.exit(1)
})
