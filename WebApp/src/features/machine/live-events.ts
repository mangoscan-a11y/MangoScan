import { useEffect } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { BinStatus, DeviceStatus, MachineStatus } from '@/lib/database.types'
import { MACHINE_STATUS_KEY } from './hooks'

const LIVE_KEY = ['live_connected'] as const

/** True while the dashboard has an open event stream to the server. */
export function useLiveConnection(): boolean {
  const { data } = useQuery({
    queryKey: LIVE_KEY,
    queryFn: () => false,
    enabled: false,
    initialData: false,
    staleTime: Infinity,
  })
  return data
}

function patchStatus(queryClient: QueryClient, patch: Partial<MachineStatus>) {
  queryClient.setQueryData<MachineStatus>(MACHINE_STATUS_KEY, (old) => (old ? { ...old, ...patch } : old))
}

const SCAN_QUERIES = ['scan_sessions', 'scan_detail', 'latest_scan', 'today_summary', 'today_classification', 'v_daily_summary', 'v_daily_classification']

/**
 * One server-sent-event stream for the whole app. New scans, bin changes and
 * device changes appear immediately instead of waiting for the next poll.
 * EventSource reconnects by itself; on reconnect everything is refetched
 * because events may have been missed in between.
 */
export function useLiveEvents() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const source = new EventSource('/api/events')
    const setLive = (live: boolean) => queryClient.setQueryData(LIVE_KEY, live)

    const refreshScans = () => {
      for (const key of SCAN_QUERIES) queryClient.invalidateQueries({ queryKey: [key] })
    }
    const on = (event: string, handler: (data: unknown) => void) =>
      source.addEventListener(event, (e) => {
        try {
          handler(JSON.parse((e as MessageEvent<string>).data))
        } catch {
          // ignore a malformed event rather than break the stream
        }
      })

    source.onopen = () => {
      setLive(true)
      queryClient.invalidateQueries({ queryKey: MACHINE_STATUS_KEY })
      refreshScans()
    }
    source.onerror = () => setLive(false)

    on('bin.updated', (data) => patchStatus(queryClient, { bins: data as BinStatus[] }))
    on('device.status', (data) => patchStatus(queryClient, { devices: data as DeviceStatus[] }))
    on('scan.created', refreshScans)
    on('scan.updated', refreshScans)

    return () => {
      source.close()
      setLive(false)
    }
  }, [queryClient])
}
