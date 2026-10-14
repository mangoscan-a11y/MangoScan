import type {
  ActuationStatus,
  ClassType,
  Disease,
  MangoVariety,
  QualityVerdict,
  RipenessLevel,
  SizeGrade,
} from '../src/lib/database.types.ts'

export type { ActuationStatus, ClassType, QualityVerdict }

export interface RefData {
  varieties: MangoVariety[]
  diseases: Disease[]
  ripeness: RipenessLevel[]
  sizes: SizeGrade[]
}

/** What the inference service returns for one scan. */
export interface InferenceModels {
  variety?: { label: string; confidence: number } | null
  disease?: { label: string; confidence: number } | null
  bruise?: { is_bruised: boolean; confidence: number } | null
  color?: { label: string; confidence: number } | null
  size?: { label?: string; grams?: number; confidence?: number } | null
}

export interface TraceStep {
  step: string
  result: string
  detail: string
}

export interface FusionDecision {
  scan_id: string
  bin_index: number
  bin_name: string
  quality_verdict: QualityVerdict
  reason_code: string
  servo1_action: string
  servo2_action: string
  detected_variety: string | null
  declared_variety: string | null
  variety_match: boolean | null
  alerts: string[]
  decision_trace: TraceStep[]
  engine_version: string
  config_version: string
}

export interface InferenceResult {
  models: InferenceModels
  decision: FusionDecision
  /** Size grade after Model 5 resolved grams against routing.toml. */
  resolved_size?: string | null
}

export interface ScanImageDoc {
  image_id: number
  scan_id: number
  image_path: string
  angle_sequence: number
  captured_at: Date
}

export interface DetectionDoc {
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

export interface SortingLogDoc {
  log_id: number
  scan_id: number
  servo1_action: string | null
  servo2_action: string | null
  gate_target: string | null
  actuation_status: ActuationStatus | 'pending'
  latency_ms: number | null
  logged_at: Date
}

/** One document per mango in the scans collection. */
export interface ScanDoc {
  scan_id: number
  scan_datetime: Date
  quality_verdict: QualityVerdict
  confidence_score: number | null
  processing_time: number
  bin_index: number
  bin_assigned: string
  reason_code: string
  alerts: string[]
  declared_variety: string | null
  variety_match: boolean | null
  is_bruised: boolean | null
  bruise_confidence: number | null
  variety: { variety_id: number; variety_name: string } | null
  disease: { disease_id: number; disease_name: string; severity_level: string } | null
  ripeness: { ripeness_id: number; ripeness_name: string } | null
  size: { size_id: number; size_name: string } | null
  images: ScanImageDoc[]
  detections: DetectionDoc[]
  sorting_log: SortingLogDoc
  decision_trace: TraceStep[]
  engine_version: string
  config_version: string
}
