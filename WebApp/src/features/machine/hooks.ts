import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiSend } from '@/lib/api'
import type { MachineStatus, ScanSessionWithRelations } from '@/lib/database.types'

export const MACHINE_STATUS_KEY = ['machine_status'] as const

export function useMachineStatus() {
  return useQuery({
    queryKey: MACHINE_STATUS_KEY,
    queryFn: () => apiGet<MachineStatus>('/api/machine/status'),
    // Live updates arrive over the event stream; this is only a safety net.
    refetchInterval: 30_000,
  })
}

export function useRunScan() {
  return useMutation({
    mutationFn: () => apiSend<ScanSessionWithRelations>('POST', '/api/machine/scan'),
  })
}

export function useSetDeclaredVariety() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (name: string | null) =>
      apiSend<{ declared_variety: string | null }>('PUT', '/api/machine/settings', { declared_variety: name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: MACHINE_STATUS_KEY }),
  })
}

export function useMockControls() {
  return {
    setBin: (bin: number, full: boolean) => apiSend('POST', '/api/dev/mock/bin', { bin, full }),
    pressMango: () => apiSend('POST', '/api/dev/mock/mango'),
  }
}
