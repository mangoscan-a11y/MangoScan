import { useState } from 'react'
import { Camera, Cpu, Play } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { useMangoVarieties } from '@/features/scans/hooks'
import { cn } from '@/lib/utils'
import { useMachineStatus, useMockControls, useRunScan, useSetDeclaredVariety } from './hooks'

const NOT_SET = 'none'

function Dot({ on }: { on: boolean }) {
  return <span className={cn('h-2 w-2 rounded-full', on ? 'bg-success' : 'bg-muted-foreground/40')} aria-hidden />
}

export function MachinePanel() {
  const { data: status } = useMachineStatus()
  const { data: varieties } = useMangoVarieties()
  const runScan = useRunScan()
  const setVariety = useSetDeclaredVariety()
  const mock = useMockControls()
  const { toast } = useToast()
  const [mockBin, setMockBin] = useState('1')

  const devices = status?.devices ?? []
  const hasCamera = devices.some((d) => d.connected && d.caps.includes('camera'))

  function scanNow() {
    runScan.mutate(undefined, {
      onSuccess: (scan) =>
        toast({ title: 'Scan #' + scan.scan_id + ' sorted', description: (scan.bin_assigned ?? 'No bin') + ' · ' + scan.quality_verdict }),
      onError: (err) => toast({ title: 'Scan failed', description: err.message, variant: 'destructive' }),
    })
  }

  function changeVariety(value: string) {
    setVariety.mutate(value === NOT_SET ? null : value, {
      onError: (err) => toast({ title: 'Could not set the batch variety', description: err.message, variant: 'destructive' }),
    })
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Machine</CardTitle>
          {status?.mode === 'mock' && <Badge variant="warning">Mock hardware</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {devices.length === 0 && <p className="text-sm text-muted-foreground">No ESP32 boards found yet. Plug them in via USB.</p>}
          {devices.map((d) => (
            <Badge key={d.id} variant="outline" className="gap-1.5 py-1">
              <Dot on={d.connected} />
              {d.caps.includes('camera') ? <Camera className="h-3 w-3" /> : <Cpu className="h-3 w-3" />}
              {d.id}
              <span className="font-normal text-muted-foreground">{d.connected ? d.port : 'disconnected'}</span>
            </Badge>
          ))}
          <Badge variant="outline" className="gap-1.5 py-1" title={status?.inference.detail}>
            <Dot on={!!status?.inference.ok} />
            Models {status?.inference.ok ? (status.inference.mode === 'mock' ? 'ready (mock)' : 'ready') : 'offline'}
          </Badge>
          {status?.inference.mode === 'mock' && (
            <Badge variant="warning" title="Classifications are simulated, not from the real models">
              Simulated results
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Batch variety (checked by Model 1)</Label>
            <Select value={status?.declared_variety ?? NOT_SET} onValueChange={changeVariety}>
              <SelectTrigger className="h-9 w-48 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NOT_SET}>Not set</SelectItem>
                {varieties?.map((v) => (
                  <SelectItem key={v.variety_id} value={v.variety_name}>
                    {v.variety_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button onClick={scanNow} disabled={!hasCamera || runScan.isPending} className="gap-2">
            <Play className="h-4 w-4" />
            {runScan.isPending ? 'Scanning…' : 'Scan now'}
          </Button>
          {!hasCamera && <p className="text-xs text-muted-foreground">Needs a connected camera.</p>}
        </div>

        {status?.mode === 'mock' && (
          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-dashed border-border p-3">
            <p className="w-full text-xs text-muted-foreground">Simulate the hardware while testing without the machine.</p>
            <Select value={mockBin} onValueChange={setMockBin}>
              <SelectTrigger className="h-8 w-28 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 8 }, (_, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)}>
                    Bin {i + 1}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={() => mock.setBin(Number(mockBin), true)}>
              Fill bin
            </Button>
            <Button size="sm" variant="outline" onClick={() => mock.setBin(Number(mockBin), false)}>
              Empty bin
            </Button>
            <Button size="sm" variant="outline" onClick={() => mock.pressMango()}>
              Mango arrives
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
