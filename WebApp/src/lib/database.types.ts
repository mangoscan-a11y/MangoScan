export type UserStatus = 'active' | 'inactive'
export type UserRole = 'admin'
export type QualityVerdict = 'passed' | 'rejected'
export type ClassType = 'variety' | 'disease' | 'bruise' | 'color' | 'size'
export type ActuationStatus = 'success' | 'failed'
export type SeverityLevel = 'none' | 'low' | 'moderate' | 'high'
export type ClassificationDimension = 'variety' | 'disease' | 'bruise' | 'color' | 'size'

export interface Profile {
  id: string
  username: string
  full_name: string
  email: string | null
  role: UserRole
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
  user_id: string | null
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

// Joined types used in the UI
export interface ScanSessionWithRelations extends ScanSession {
  mango_varieties: MangoVariety | null
  diseases: Disease | null
  ripeness_levels: RipenessLevel | null
  size_grades: SizeGrade | null
  profiles: Pick<Profile, 'full_name' | 'username'> | null
}
