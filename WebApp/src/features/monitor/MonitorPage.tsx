import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { ScanSessionWithRelations, VDailySummary, VDailyClassification } from '@/lib/database.types'
import { DIMENSIONS, pivotDailyClassification } from '@/lib/classification'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { CheckCircle2, XCircle, Layers, Clock, Activity } from 'lucide-react'
import { format } from 'date-fns'

function todayInManila() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())
}

function useTodaySummary() {
  return useQuery({
    queryKey: ['today_summary'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_daily_summary')
        .select('*')
        .eq('summary_date', todayInManila())
        .maybeSingle()

      if (error) throw error
      return data as VDailySummary | null
    },
    refetchInterval: 15_000,
  })
}

function useTodayClassification() {
  return useQuery({
    queryKey: ['today_classification'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_daily_classification')
        .select('*')
        .eq('summary_date', todayInManila())

      if (error) throw error
      return data as VDailyClassification[]
    },
    refetchInterval: 15_000,
  })
}

function useLatestScan() {
  return useQuery({
    queryKey: ['latest_scan'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('scan_sessions')
        .select(`
          *,
          mango_varieties ( variety_id, variety_name ),
          diseases ( disease_id, disease_name, severity_level ),
          ripeness_levels ( ripeness_id, ripeness_name ),
          size_grades ( size_id, size_name ),
          profiles ( full_name, username )
        `)
        .order('scan_datetime', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error) throw error
      return data as ScanSessionWithRelations | null
    },
    refetchInterval: 15_000,
  })
}

function useLastLatency() {
  return useQuery({
    queryKey: ['last_latency'],
    queryFn: async () => {
      const { data } = await supabase
        .from('sorting_logs')
        .select('latency_ms, actuation_status, logged_at')
        .order('logged_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      return data
    },
    refetchInterval: 15_000,
  })
}

interface StatCardProps {
  title: string
  value: string | number
  icon: React.ElementType
  iconClass?: string
  loading?: boolean
}

function StatCard({ title, value, icon: Icon, iconClass, loading }: StatCardProps) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 pt-5 pb-5">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl shrink-0 ${iconClass ?? 'bg-muted'}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{title}</p>
          {loading ? (
            <Skeleton className="h-6 w-12 mt-0.5" />
          ) : (
            <p className="text-2xl font-bold font-mono leading-tight">{value}</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function DimensionCard({
  title,
  breakdown,
  loading,
}: {
  title: string
  breakdown: { name: string; value: number }[]
  loading: boolean
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-1.5">
        {loading ? (
          <>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </>
        ) : breakdown.length === 0 ? (
          <p className="text-sm text-muted-foreground">No scans yet today.</p>
        ) : (
          breakdown.map((b) => (
            <div key={b.name} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground truncate">{b.name}</span>
              <span className="font-mono font-medium">{b.value}</span>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

export default function MonitorPage() {
  const { data: summary, isLoading: summaryLoading } = useTodaySummary()
  const { data: classification, isLoading: classificationLoading } = useTodayClassification()
  const { data: latest, isLoading: latestLoading } = useLatestScan()
  const { data: latency } = useLastLatency()

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Live Monitor</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Today's sorting activity — refreshes every 15 seconds.
          </p>
        </div>

        {/* Device status strip */}
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
          <span className="flex h-2 w-2 rounded-full bg-primary animate-pulse" />
          <span className="text-muted-foreground">ESP32</span>
          <span className="text-foreground font-medium">
            {latency ? 'Online' : 'Awaiting data'}
          </span>
          {latency?.latency_ms && (
            <span className="font-mono text-xs text-muted-foreground">{latency.latency_ms} ms</span>
          )}
        </div>
      </div>

      {/* Today's totals */}
      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-3">Today's Totals</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatCard title="Total Scanned" value={summary?.total_scanned ?? 0} icon={Layers} iconClass="bg-secondary text-foreground" loading={summaryLoading} />
          <StatCard title="Passed" value={summary?.total_passed ?? 0} icon={CheckCircle2} iconClass="bg-success/10 text-success" loading={summaryLoading} />
          <StatCard title="Rejected" value={summary?.total_rejected ?? 0} icon={XCircle} iconClass="bg-destructive/10 text-destructive" loading={summaryLoading} />
        </div>
      </div>

      {/* Today's classification breakdown */}
      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-3">Today's Classification</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {DIMENSIONS.map((dim) => (
            <DimensionCard
              key={dim.key}
              title={dim.label}
              breakdown={pivotDailyClassification(classification, dim.key)}
              loading={classificationLoading}
            />
          ))}
        </div>
      </div>

      {/* Latest scan */}
      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-3">Latest Scan</h2>
        {latestLoading ? (
          <Card>
            <CardContent className="pt-5 space-y-3">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </CardContent>
          </Card>
        ) : latest ? (
          <Card className="overflow-hidden">
            <div className={`h-1 w-full ${latest.quality_verdict === 'passed' ? 'bg-success' : 'bg-destructive'}`} />
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  Scan #{latest.scan_id}
                  <Badge variant={latest.quality_verdict === 'passed' ? 'success' : 'destructive'} className="gap-1">
                    {latest.quality_verdict === 'passed'
                      ? <><CheckCircle2 className="h-3 w-3" /> Passed</>
                      : <><XCircle className="h-3 w-3" /> Rejected</>}
                  </Badge>
                </CardTitle>
                <span className="text-xs text-muted-foreground">
                  {format(new Date(latest.scan_datetime), 'MMM d, HH:mm:ss')}
                </span>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs">Variety</p>
                  <p className="font-medium">{latest.mango_varieties?.variety_name ?? '—'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Disease</p>
                  <p className="font-medium">{latest.diseases?.disease_name ?? '—'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Bruise</p>
                  <p className={`font-medium ${latest.is_bruised ? 'text-destructive' : ''}`}>
                    {latest.is_bruised == null ? '—' : latest.is_bruised ? 'Bruised' : 'Not Bruised'}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Color</p>
                  <p className="font-medium">{latest.ripeness_levels?.ripeness_name ?? '—'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Size</p>
                  <p className="font-medium">{latest.size_grades?.size_name ?? '—'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Confidence</p>
                  <p className="font-mono font-medium">
                    {latest.confidence_score != null ? `${latest.confidence_score.toFixed(1)}%` : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs flex items-center gap-1">
                    <Clock className="h-3 w-3" /> Processing
                  </p>
                  <p className="font-mono font-medium">
                    {latest.processing_time != null ? `${latest.processing_time.toFixed(2)}s` : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Bin Assigned</p>
                  <p className="font-medium">{latest.bin_assigned ?? '—'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Operator</p>
                  <p className="font-medium">{latest.profiles?.full_name ?? 'System'}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Activity className="h-8 w-8 text-muted-foreground mb-3" />
              <p className="text-muted-foreground">No scans recorded yet.</p>
              <p className="text-xs text-muted-foreground mt-1">Run the simulator: <code className="font-mono bg-muted px-1 rounded">npm run simulator</code></p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
