import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Camera, Radio, ScanEye } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { binLabel } from '@/features/bins/bin-alerts'
import { apiBlob, apiSend } from '@/lib/api'
import type { DeviceStatus, SensorReading } from '@/lib/database.types'
import { cn } from '@/lib/utils'
import { describeSensor, installedSensors, missingSensorsNote } from './sensor-status'

/** Live view asks for a new photo this often at most, so it stays light on the serial link. */
const LIVE_MIN_GAP_MS = 400
const SENSOR_POLL_MS = 700

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

function CameraView({ camera }: { camera: DeviceStatus }) {
  const [shot, setShot] = useState<{ url: string; at: Date; ms: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [live, setLive] = useState(false)
  const alive = useRef(true)
  const currentUrl = useRef<string | null>(null)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      if (currentUrl.current) URL.revokeObjectURL(currentUrl.current)
    }
  }, [])

  const take = useCallback(async (): Promise<boolean> => {
    const started = performance.now()
    setBusy(true)
    try {
      const blob = await apiBlob('POST', '/api/machine/preview/' + encodeURIComponent(camera.id))
      if (!alive.current) return false
      const url = URL.createObjectURL(blob)
      if (currentUrl.current) URL.revokeObjectURL(currentUrl.current)
      currentUrl.current = url
      setShot({ url, at: new Date(), ms: Math.round(performance.now() - started) })
      setError(null)
      return true
    } catch (err) {
      if (alive.current) setError(errorText(err))
      return false
    } finally {
      if (alive.current) setBusy(false)
    }
  }, [camera.id])

  // One photo as soon as the window opens.
  useEffect(() => {
    void take()
  }, [take])

  useEffect(() => {
    if (!live) return
    let stop = false
    void (async () => {
      while (!stop) {
        const started = Date.now()
        const ok = await take()
        await sleep(ok ? Math.max(0, LIVE_MIN_GAP_MS - (Date.now() - started)) : 1500)
      }
    })()
    return () => {
      stop = true
    }
  }, [live, take])

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Camera className="h-4 w-4" />
          {camera.id}
          <span className="text-xs font-normal text-muted-foreground">{camera.port}</span>
        </p>
        {error ? <Badge variant="destructive">No photo</Badge> : shot && <Badge variant="success">Working</Badge>}
      </div>

      <div className="aspect-[4/3] overflow-hidden rounded-lg border border-border bg-black">
        {shot ? (
          <img src={shot.url} alt={'Photo from ' + camera.id} className="h-full w-full object-contain" />
        ) : (
          <div className="grid h-full place-items-center text-sm text-white/60">{busy ? 'Taking a photo…' : 'No photo yet'}</div>
        )}
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => void take()} disabled={busy || live}>
          Take photo
        </Button>
        <Button size="sm" variant={live ? 'default' : 'outline'} onClick={() => setLive((v) => !v)}>
          {live ? 'Stop live view' : 'Live view'}
        </Button>
        {shot && (
          <span className="text-xs text-muted-foreground">
            {shot.at.toLocaleTimeString('en-GB')} · {(shot.ms / 1000).toFixed(1)} s
          </span>
        )}
      </div>
    </div>
  )
}

function useSensors() {
  return useQuery({
    queryKey: ['hardware_sensors'],
    queryFn: async () => (await apiSend<{ sensors: SensorReading[] }>('POST', '/api/machine/sensors')).sensors,
    refetchInterval: (query) => (query.state.status === 'error' ? 3000 : SENSOR_POLL_MS),
    refetchOnWindowFocus: false,
    retry: false,
    gcTime: 0,
  })
}

function SensorList() {
  const { data, error } = useSensors()
  const installed = data ? installedSensors(data) : []
  const note = data ? missingSensorsNote(data) : null

  return (
    <div className="space-y-2">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Radio className="h-4 w-4" />
        Bin sensors
      </p>
      <p className="text-xs text-muted-foreground">Updates live while this window is open. Hold something in front of a sensor to test it.</p>

      {error && <p className="text-xs text-destructive">{error.message}</p>}
      {!data && !error && <p className="text-sm text-muted-foreground">Reading…</p>}

      {installed.map((r) => {
        const d = describeSensor(r)
        return (
          <div key={r.bin} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-medium">{binLabel(r.bin)}</p>
              <p className="text-xs text-muted-foreground">{d.label}</p>
            </div>
            <p className="flex shrink-0 items-center gap-2 font-mono text-lg tabular-nums">
              <span className={cn('h-2 w-2 rounded-full', d.ok ? 'bg-success' : 'bg-warning')} aria-hidden />
              {d.value}
            </p>
          </div>
        )
      })}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  )
}

export function HardwareCheckDialog({ devices }: { devices: DeviceStatus[] }) {
  const cameras = devices.filter((d) => d.connected && d.caps.includes('camera'))
  const hasController = devices.some((d) => d.connected && d.caps.includes('bins'))

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <ScanEye className="h-4 w-4" />
          Check hardware
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Check hardware</DialogTitle>
          <DialogDescription>A look at the camera and the bin sensors. Nothing is scanned or saved, and no servo moves.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {cameras.length === 0 ? (
            <p className="text-sm text-muted-foreground">No camera is connected.</p>
          ) : (
            cameras.map((c) => <CameraView key={c.id} camera={c} />)
          )}
          {hasController ? <SensorList /> : <p className="text-sm text-muted-foreground">The controller is not connected, so the bin sensors cannot be read.</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
