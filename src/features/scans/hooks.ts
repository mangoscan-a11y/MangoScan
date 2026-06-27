import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { ScanSessionWithRelations, ScanImage, DetectionResult, SortingLog } from '@/lib/database.types'

export interface ScanFilters {
  verdict?: string
  varietyId?: string
  diseaseId?: string
  dateFrom?: string
  dateTo?: string
  page: number
  pageSize: number
}

export function useScanSessions(filters: ScanFilters) {
  return useQuery({
    queryKey: ['scan_sessions', filters],
    queryFn: async () => {
      const from = (filters.page - 1) * filters.pageSize
      const to = from + filters.pageSize - 1

      let query = supabase
        .from('scan_sessions')
        .select(`
          *,
          mango_varieties ( variety_id, variety_name ),
          diseases ( disease_id, disease_name, severity_level ),
          profiles ( full_name, username )
        `, { count: 'exact' })
        .order('scan_datetime', { ascending: false })
        .range(from, to)

      if (filters.verdict) query = query.eq('quality_verdict', filters.verdict)
      if (filters.varietyId) query = query.eq('variety_id', filters.varietyId)
      if (filters.diseaseId) query = query.eq('disease_id', filters.diseaseId)
      if (filters.dateFrom) query = query.gte('scan_datetime', filters.dateFrom)
      if (filters.dateTo) query = query.lte('scan_datetime', filters.dateTo + 'T23:59:59Z')

      const { data, error, count } = await query
      if (error) throw error

      return { data: data as ScanSessionWithRelations[], count: count ?? 0 }
    },
  })
}

export function useScanDetail(scanId: number | null) {
  return useQuery({
    queryKey: ['scan_detail', scanId],
    enabled: scanId !== null,
    queryFn: async () => {
      if (!scanId) return null

      const [imagesRes, detectionsRes, logsRes] = await Promise.all([
        supabase
          .from('scan_images')
          .select('*')
          .eq('scan_id', scanId)
          .order('angle_sequence'),
        supabase
          .from('detection_result')
          .select('*')
          .eq('scan_id', scanId)
          .order('confidence', { ascending: false }),
        supabase
          .from('sorting_logs')
          .select('*')
          .eq('scan_id', scanId)
          .single(),
      ])

      if (imagesRes.error) throw imagesRes.error
      if (detectionsRes.error) throw detectionsRes.error

      return {
        images: imagesRes.data as ScanImage[],
        detections: detectionsRes.data as DetectionResult[],
        log: logsRes.data as SortingLog | null,
      }
    },
  })
}

export function useMangoVarieties() {
  return useQuery({
    queryKey: ['mango_varieties'],
    queryFn: async () => {
      const { data, error } = await supabase.from('mango_varieties').select('*').order('variety_name')
      if (error) throw error
      return data
    },
    staleTime: Infinity,
  })
}

export function useDiseases() {
  return useQuery({
    queryKey: ['diseases'],
    queryFn: async () => {
      const { data, error } = await supabase.from('diseases').select('*').order('disease_name')
      if (error) throw error
      return data
    },
    staleTime: Infinity,
  })
}
