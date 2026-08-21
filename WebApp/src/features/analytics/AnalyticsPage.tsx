import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { VDailySummary, VDailyClassification, ClassificationDimension } from '@/lib/database.types'
import { DIMENSIONS, pivotDailyClassification, colorForLabel, toCsvRow } from '@/lib/classification'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Download, BarChart3 } from 'lucide-react'
import { subDays, format } from 'date-fns'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from 'recharts'

const COLORS = {
  passed: '#22c55e',
  rejected: '#ef4444',
  confidence: '#6366f1',
}

function useDailySummary(dateFrom: string, dateTo: string) {
  return useQuery({
    queryKey: ['v_daily_summary', dateFrom, dateTo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_daily_summary')
        .select('*')
        .gte('summary_date', dateFrom)
        .lte('summary_date', dateTo)
        .order('summary_date')

      if (error) throw error
      return data as VDailySummary[]
    },
  })
}

function useDailyClassification(dateFrom: string, dateTo: string) {
  return useQuery({
    queryKey: ['v_daily_classification', dateFrom, dateTo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_daily_classification')
        .select('*')
        .gte('summary_date', dateFrom)
        .lte('summary_date', dateTo)

      if (error) throw error
      return data as VDailyClassification[]
    },
  })
}

function downloadCsv(data: VDailySummary[]) {
  const header = toCsvRow(['Date', 'Total Scanned', 'Passed', 'Rejected', 'Avg Confidence (%)', 'Avg Processing (s)'])
  const rows = data.map((d) =>
    toCsvRow([
      d.summary_date,
      d.total_scanned,
      d.total_passed,
      d.total_rejected,
      d.avg_confidence?.toFixed(2) ?? '',
      d.avg_processing_time?.toFixed(2) ?? '',
    ])
  )
  const csv = [header, ...rows].join('\n')
  triggerDownload(csv, `mangoscan-summary-${format(new Date(), 'yyyy-MM-dd')}.csv`)
}

function triggerDownload(csv: string, filename: string) {
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

async function downloadDetailedCsv(dateFrom: string, dateTo: string) {
  const { data, error } = await supabase
    .from('scan_sessions')
    .select(`
      scan_id, scan_datetime, quality_verdict, confidence_score, processing_time, bin_assigned,
      is_bruised, bruise_confidence,
      mango_varieties ( variety_name ),
      diseases ( disease_name, severity_level ),
      ripeness_levels ( ripeness_name ),
      size_grades ( size_name ),
      profiles ( full_name, username ),
      sorting_logs ( servo1_action, servo2_action, gate_target, actuation_status, latency_ms )
    `)
    .gte('scan_datetime', dateFrom)
    .lte('scan_datetime', dateTo + 'T23:59:59Z')
    .order('scan_datetime', { ascending: false })

  if (error) throw error

  type Row = {
    scan_id: number
    scan_datetime: string
    quality_verdict: string
    confidence_score: number | null
    processing_time: number | null
    bin_assigned: string | null
    is_bruised: boolean | null
    bruise_confidence: number | null
    mango_varieties: { variety_name: string } | null
    diseases: { disease_name: string; severity_level: string } | null
    ripeness_levels: { ripeness_name: string } | null
    size_grades: { size_name: string } | null
    profiles: { full_name: string; username: string } | null
    sorting_logs: { servo1_action: string | null; servo2_action: string | null; gate_target: string | null; actuation_status: string; latency_ms: number | null } | null
  }

  const header = toCsvRow([
    'Scan ID', 'Date/Time', 'Variety', 'Disease', 'Severity',
    'Bruised', 'Color', 'Size',
    'Verdict', 'Confidence (%)', 'Processing (s)', 'Bin Assigned',
    'Operator', 'Servo 1', 'Servo 2', 'Gate Target', 'Actuation', 'Latency (ms)',
  ])

  const rows = (data as unknown as Row[]).map((r) =>
    toCsvRow([
      r.scan_id,
      format(new Date(r.scan_datetime), 'yyyy-MM-dd HH:mm:ss'),
      r.mango_varieties?.variety_name ?? '',
      r.diseases?.disease_name ?? '',
      r.diseases?.severity_level ?? '',
      r.is_bruised == null ? '' : r.is_bruised ? 'Bruised' : 'Not Bruised',
      r.ripeness_levels?.ripeness_name ?? '',
      r.size_grades?.size_name ?? '',
      r.quality_verdict,
      r.confidence_score?.toFixed(2) ?? '',
      r.processing_time?.toFixed(2) ?? '',
      r.bin_assigned ?? '',
      r.profiles?.full_name ?? 'System',
      r.sorting_logs?.servo1_action ?? '',
      r.sorting_logs?.servo2_action ?? '',
      r.sorting_logs?.gate_target ?? '',
      r.sorting_logs?.actuation_status ?? '',
      r.sorting_logs?.latency_ms ?? '',
    ])
  )

  const csv = [header, ...rows].join('\n')
  triggerDownload(csv, `mangoscan-scans-${format(new Date(), 'yyyy-MM-dd')}.csv`)
}

const tooltipStyle = {
  backgroundColor: 'hsl(222 47% 14%)',
  border: '1px solid hsl(215 25% 22%)',
  borderRadius: '8px',
  color: 'hsl(210 40% 98%)',
}

export default function AnalyticsPage() {
  const [dateFrom, setDateFrom] = useState(format(subDays(new Date(), 7), 'yyyy-MM-dd'))
  const [dateTo, setDateTo] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [exportingDetailed, setExportingDetailed] = useState(false)
  const [distributionDimension, setDistributionDimension] = useState<ClassificationDimension>('variety')

  async function handleDetailedExport() {
    setExportingDetailed(true)
    try {
      await downloadDetailedCsv(dateFrom, dateTo)
    } finally {
      setExportingDetailed(false)
    }
  }

  const { data: daily, isLoading } = useDailySummary(dateFrom, dateTo)
  const { data: classification } = useDailyClassification(dateFrom, dateTo)

  const verdictData = daily
    ? [
        { name: 'Passed', value: daily.reduce((a, d) => a + d.total_passed, 0) },
        { name: 'Rejected', value: daily.reduce((a, d) => a + d.total_rejected, 0) },
      ]
    : []

  const distributionData = pivotDailyClassification(classification, distributionDimension)

  const throughputData = daily?.map((d) => ({
    date: format(new Date(d.summary_date + 'T00:00:00'), 'MMM d'),
    passed: d.total_passed,
    rejected: d.total_rejected,
    total: d.total_scanned,
  }))

  const confidenceData = daily?.map((d) => ({
    date: format(new Date(d.summary_date + 'T00:00:00'), 'MMM d'),
    confidence: d.avg_confidence ? parseFloat(d.avg_confidence.toFixed(1)) : null,
    processingTime: d.avg_processing_time ? parseFloat(d.avg_processing_time.toFixed(2)) : null,
  }))

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">Analytics & Reports</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Sorting performance over time.</p>
        </div>

        <div className="flex items-end gap-3 flex-wrap">
          <div className="space-y-1">
            <Label className="text-xs">From</Label>
            <Input type="date" className="h-8 w-36 text-xs" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">To</Label>
            <Input type="date" className="h-8 w-36 text-xs" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => daily && downloadCsv(daily)}
            disabled={!daily || daily.length === 0}
          >
            <Download className="h-3.5 w-3.5" />
            Summary CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={handleDetailedExport}
            disabled={exportingDetailed}
          >
            <Download className="h-3.5 w-3.5" />
            {exportingDetailed ? 'Exporting…' : 'Detailed CSV'}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="pt-5">
                <Skeleton className="h-48 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : daily?.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <BarChart3 className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No data in the selected date range.</p>
            <p className="text-xs text-muted-foreground mt-1">Try running the simulator or choosing a broader date range.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Throughput over time */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Daily Throughput</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={throughputData} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(215 25% 22%)" />
                  <XAxis dataKey="date" tick={{ fill: 'hsl(215 20% 65%)', fontSize: 12 }} />
                  <YAxis tick={{ fill: 'hsl(215 20% 65%)', fontSize: 12 }} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend />
                  <Bar dataKey="passed" name="Passed" fill={COLORS.passed} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="rejected" name="Rejected" fill={COLORS.rejected} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Pass / Reject pie */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Pass vs Reject Ratio</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={verdictData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    <Cell fill={COLORS.passed} />
                    <Cell fill={COLORS.rejected} />
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Classification distribution — switchable across the 5 dimensions */}
          <Card>
            <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-medium">Classification Distribution</CardTitle>
              <Select value={distributionDimension} onValueChange={(v) => setDistributionDimension(v as ClassificationDimension)}>
                <SelectTrigger className="h-7 w-32 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DIMENSIONS.map((dim) => (
                    <SelectItem key={dim.key} value={dim.key}>{dim.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={distributionData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={({ percent }) => `${(percent * 100).toFixed(0)}%`}
                  >
                    {distributionData.map((entry, idx) => (
                      <Cell key={entry.name} fill={colorForLabel(entry.name, idx)} />
                    ))}
                  </Pie>
                  <Legend />
                  <Tooltip contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Avg confidence + processing time */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Avg Confidence (%) over Time</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={confidenceData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(215 25% 22%)" />
                  <XAxis dataKey="date" tick={{ fill: 'hsl(215 20% 65%)', fontSize: 12 }} />
                  <YAxis domain={[60, 100]} tick={{ fill: 'hsl(215 20% 65%)', fontSize: 12 }} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Line type="monotone" dataKey="confidence" name="Confidence %" stroke={COLORS.confidence} strokeWidth={2} dot={false} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
