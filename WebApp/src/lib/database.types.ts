export type QualityVerdict = 'passed' | 'rejected'
export type ClassType = 'variety' | 'disease' | 'bruise' | 'color' | 'size'
export type ActuationStatus = 'success' | 'failed' | 'pending'
export type SeverityLevel = 'none' | 'low' | 'moderate' | 'high'
export type ClassificationDimension = 'variety' | 'disease' | 'bruise' | 'color' | 'size'

export interface MangoVariety {
  variety_id: number
  variety_name: string
  description: string | null
  market_price: number | null
}

export interface Disease {
  disease_id: number
  disease_name: string
  description: string | null
  severity_level: SeverityLevel
}

export interface RipenessLevel {
  ripeness_id: number
  ripeness_name: string
  description: string | null
  sort_order: number
}

export interface SizeGrade {
  size_id: number
  size_name: string
  description: string | null
  min_grams: number | null
  max_grams: number | null
  sort_order: number
}

export interface ScanSession {
  scan_id: number
  variety_id: number | null
  disease_id: number | null
  ripeness_id: number | null
  size_id: number | null
  is_bruised: boolean | null
  bruise_confidence: number | null
  quality_verdict: QualityVerdict
  confidence_score: number | null
  processing_time: number | null
  bin_assigned: string | null
  bin_index: number | null
  reason_code: string | null
  alerts: string[]
  declared_variety: string | null
  variety_match: boolean | null
  scan_datetime: string
}

export interface ScanImage {
  image_id: number
  scan_id: number
  image_path: string
  angle_sequence: number
  captured_at: string
}

export interface DetectionResult {
  result_id: number
  scan_id: number
  image_id: number | null
  detected_class: string
  class_type: ClassType
  confidence: number
  bbox_x: number | null
  bbox_y: number | null
  bbox_w: number | null
  bbox_h: number | null
}

export interface SortingLog {
  log_id: number
  scan_id: number
  servo1_action: string | null
  servo2_action: string | null
  gate_target: string | null
  actuation_status: ActuationStatus
  latency_ms: number | null
  logged_at: string
}

export interface VDailySummary {
  summary_date: string
  total_scanned: number
  total_passed: number
  total_rejected: number
  avg_confidence: number | null
  avg_processing_time: number | null
}

export interface VDailyClassification {
  summary_date: string
  dimension: ClassificationDimension
  label: string
  count: number
  sort_order: number
}

// Joined shape the UI works with (the server resolves the relations)
export interface ScanSessionWithRelations extends ScanSession {
  mango_varieties: MangoVariety | null
  diseases: Disease | null
  ripeness_levels: RipenessLevel | null
  size_grades: SizeGrade | null
}

export interface ScanDetail {
  images: ScanImage[]
  detections: DetectionResult[]
  log: SortingLog | null
  decision_trace: { step: string; result: string; detail: string }[]
}

// Machine state
export interface BinStatus {
  bin_index: number
  full: boolean
  full_since: string | null
  updated_at: string | null
}

export interface DeviceStatus {
  id: string
  port: string
  caps: string[]
  angles: number[]
  fw: string | null
  connected: boolean
  connected_at: string | null
  last_seen: string | null
}

/** One bin's ultrasonic sensor, read on demand. absent means no sensor is installed for that bin. */
export interface SensorReading {
  bin: number
  state: 'ok' | 'no_echo' | 'absent'
  cm: number | null
}

export interface MachineStatus {
  mode: 'serial' | 'mock'
  devices: DeviceStatus[]
  bins: BinStatus[]
  inference: { ok: boolean; detail?: string; mode?: 'mock' | 'custom' | 'none' }
  declared_variety: string | null
}

export interface ExportRow {
  scan_id: number
  scan_datetime: string
  variety: string | null
  disease: string | null
  severity: string | null
  is_bruised: boolean | null
  color: string | null
  size: string | null
  quality_verdict: QualityVerdict
  confidence_score: number | null
  processing_time: number | null
  bin_assigned: string | null
  reason_code: string | null
  alerts: string[]
  servo1_action: string | null
  servo2_action: string | null
  gate_target: string | null
  actuation_status: ActuationStatus | null
  latency_ms: number | null
}
