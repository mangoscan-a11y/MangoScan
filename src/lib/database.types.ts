export type UserStatus = 'active' | 'inactive'
export type QualityVerdict = 'passed' | 'rejected'
export type ClassType = 'variety' | 'disease'
export type ActuationStatus = 'success' | 'failed'
export type SeverityLevel = 'none' | 'low' | 'moderate' | 'high'

export interface Profile {
  id: string
  username: string
  full_name: string
  email: string | null
  status: UserStatus
  created_at: string
  last_login: string | null
}

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

export interface ScanSession {
  scan_id: number
  user_id: string | null
  variety_id: number | null
  disease_id: number | null
  quality_verdict: QualityVerdict
  confidence_score: number | null
  processing_time: number | null
  bin_assigned: string | null
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

export interface DailySummary {
  summary_id: number
  summary_date: string
  total_scanned: number
  total_passed: number
  total_rejected: number
  carabao_count: number
  indian_count: number
  apple_count: number
}

export interface VDailySummary {
  summary_date: string
  total_scanned: number
  total_passed: number
  total_rejected: number
  carabao_count: number
  indian_count: number
  apple_count: number
  avg_confidence: number | null
  avg_processing_time: number | null
}

// Joined types used in the UI
export interface ScanSessionWithRelations extends ScanSession {
  mango_varieties: MangoVariety | null
  diseases: Disease | null
  profiles: Pick<Profile, 'full_name' | 'username'> | null
}
