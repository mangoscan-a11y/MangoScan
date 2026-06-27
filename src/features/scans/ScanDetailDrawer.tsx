import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { useScanDetail } from './hooks'
import type { ScanSessionWithRelations } from '@/lib/database.types'
import { format } from 'date-fns'
import { CheckCircle2, XCircle, Clock, Cpu } from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface Props {
  scan: ScanSessionWithRelations | null
  onClose: () => void
}

function getImageUrl(path: string) {
  if (path.startsWith('http')) return path
  const { data } = supabase.storage.from('scan-images').getPublicUrl(path)
  return data.publicUrl
}

export function ScanDetailDrawer({ scan, onClose }: Props) {
  const { data: detail, isLoading } = useScanDetail(scan?.scan_id ?? null)

  return (
    <Dialog open={!!scan} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto scrollbar-thin">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            Scan #{scan?.scan_id}
            {scan && (
              <Badge variant={scan.quality_verdict === 'passed' ? 'success' : 'destructive'}>
                {scan.quality_verdict === 'passed' ? (
                  <><CheckCircle2 className="h-3 w-3 mr-1" />Passed</>
                ) : (
                  <><XCircle className="h-3 w-3 mr-1" />Rejected</>
                )}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {scan && (
          <div className="space-y-5">
            {/* Meta */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="space-y-0.5">
                <p className="text-muted-foreground">Date & Time</p>
                <p className="font-medium">{format(new Date(scan.scan_datetime), 'MMM d, yyyy HH:mm:ss')}</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-muted-foreground">Variety</p>
                <p className="font-medium">{scan.mango_varieties?.variety_name ?? '—'}</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-muted-foreground">Disease</p>
                <p className="font-medium">{scan.diseases?.disease_name ?? '—'}</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-muted-foreground">Confidence</p>
                <p className="font-medium font-mono">
                  {scan.confidence_score != null ? `${scan.confidence_score.toFixed(1)}%` : '—'}
                </p>
              </div>
              <div className="space-y-0.5">
                <p className="text-muted-foreground">Bin Assigned</p>
                <p className="font-medium">{scan.bin_assigned ?? '—'}</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-muted-foreground">Processing Time</p>
                <p className="font-medium font-mono flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {scan.processing_time != null ? `${scan.processing_time.toFixed(2)}s` : '—'}
                </p>
              </div>
            </div>

            <Separator />

            {/* Images */}
            <div>
              <h3 className="text-sm font-semibold mb-3">Captured Images (5 angles)</h3>
              {isLoading ? (
                <div className="grid grid-cols-5 gap-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="aspect-square rounded-lg" />
                  ))}
                </div>
              ) : detail?.images.length ? (
                <div className="grid grid-cols-5 gap-2">
                  {detail.images.map((img) => (
                    <div key={img.image_id} className="space-y-1">
                      <div className="aspect-square rounded-lg border border-border overflow-hidden bg-muted">
                        <img
                          src={getImageUrl(img.image_path)}
                          alt={`Angle ${img.angle_sequence}`}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'%3E%3Crect width='80' height='80' fill='%23334155'/%3E%3Ctext x='40' y='45' text-anchor='middle' fill='%2364748b' font-size='12'%3E${img.angle_sequence}%3C/text%3E%3C/svg%3E`
                          }}
                        />
                      </div>
                      <p className="text-xs text-center text-muted-foreground">#{img.angle_sequence}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No images recorded.</p>
              )}
            </div>

            <Separator />

            {/* Detections */}
            <div>
              <h3 className="text-sm font-semibold mb-3">Detection Results</h3>
              {isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : detail?.detections.length ? (
                <div className="space-y-2">
                  {detail.detections.map((det) => (
                    <div key={det.result_id} className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Cpu className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">{det.detected_class}</span>
                        <Badge variant="outline" className="text-xs capitalize">{det.class_type}</Badge>
                      </div>
                      <span className="font-mono text-sm text-primary">{det.confidence.toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No detections recorded.</p>
              )}
            </div>

            <Separator />

            {/* Sorting log */}
            <div>
              <h3 className="text-sm font-semibold mb-3">Sorting Actuation Log</h3>
              {isLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : detail?.log ? (
                <div className="grid grid-cols-2 gap-3 text-sm rounded-lg border border-border bg-muted/30 p-3">
                  <div>
                    <p className="text-muted-foreground">Servo 1 (Reject/Pass)</p>
                    <p className="font-mono font-medium">{detail.log.servo1_action ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Servo 2 (Variety)</p>
                    <p className="font-mono font-medium">{detail.log.servo2_action ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Target Lane</p>
                    <p className="font-medium">{detail.log.gate_target ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Latency</p>
                    <p className="font-mono font-medium">{detail.log.latency_ms != null ? `${detail.log.latency_ms} ms` : '—'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Status</p>
                    <Badge variant={detail.log.actuation_status === 'success' ? 'success' : 'destructive'} className="capitalize">
                      {detail.log.actuation_status}
                    </Badge>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No actuation log recorded.</p>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
