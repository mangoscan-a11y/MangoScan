import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type {
  Disease,
  MangoVariety,
  RipenessLevel,
  ScanDetail,
  ScanSessionWithRelations,
  SizeGrade,
} from '@/lib/database.types'

export interface ScanFilters {
  verdict?: string
  varietyId?: string
  diseaseId?: string
  ripenessId?: string
  sizeId?: string
  bruised?: string
  dateFrom?: string
  dateTo?: string
  page: number
  pageSize: number
}

export function useScanSessions(filters: ScanFilters) {
  return useQuery({
    queryKey: ['scan_sessions', filters],
    queryFn: () =>
      apiGet<{ data: ScanSessionWithRelations[]; count: number }>('/api/scans', {
        verdict: filters.verdict,
        varietyId: filters.varietyId,
        diseaseId: filters.diseaseId,
        ripenessId: filters.ripenessId,
        sizeId: filters.sizeId,
        bruised: filters.bruised,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        page: filters.page,
        pageSize: filters.pageSize,
      }),
  })
}

export function useScanDetail(scanId: number | null) {
  return useQuery({
    queryKey: ['scan_detail', scanId],
    enabled: scanId !== null,
    queryFn: () => apiGet<ScanDetail>('/api/scans/' + scanId + '/detail'),
  })
}

// Reference tables change about never, so they are fetched once per session.
export function useMangoVarieties() {
  return useQuery({
    queryKey: ['mango_varieties'],
    queryFn: () => apiGet<MangoVariety[]>('/api/reference/varieties'),
    staleTime: Infinity,
  })
}

export function useDiseases() {
  return useQuery({
    queryKey: ['diseases'],
    queryFn: () => apiGet<Disease[]>('/api/reference/diseases'),
    staleTime: Infinity,
  })
}

export function useRipenessLevels() {
  return useQuery({
    queryKey: ['ripeness_levels'],
    queryFn: () => apiGet<RipenessLevel[]>('/api/reference/ripeness'),
    staleTime: Infinity,
  })
}

export function useSizeGrades() {
  return useQuery({
    queryKey: ['size_grades'],
    queryFn: () => apiGet<SizeGrade[]>('/api/reference/sizes'),
    staleTime: Infinity,
  })
}
