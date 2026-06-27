import { useState } from 'react'
import { format } from 'date-fns'
import { useScanSessions, useMangoVarieties, useDiseases, type ScanFilters } from './hooks'
import { ScanDetailDrawer } from './ScanDetailDrawer'
import type { ScanSessionWithRelations } from '@/lib/database.types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
import { CheckCircle2, XCircle, ChevronLeft, ChevronRight, SlidersHorizontal, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 15

function VerdictBadge({ verdict }: { verdict: string }) {
  return verdict === 'passed' ? (
    <Badge variant="success" className="gap-1">
      <CheckCircle2 className="h-3 w-3" /> Passed
    </Badge>
  ) : (
    <Badge variant="destructive" className="gap-1">
      <XCircle className="h-3 w-3" /> Rejected
    </Badge>
  )
}

export default function ScansPage() {
  const [page, setPage] = useState(1)
  const [selectedScan, setSelectedScan] = useState<ScanSessionWithRelations | null>(null)
  const [filters, setFilters] = useState<Omit<ScanFilters, 'page' | 'pageSize'>>({})

  const activeFilters: ScanFilters = { ...filters, page, pageSize: PAGE_SIZE }
  const { data, isLoading } = useScanSessions(activeFilters)
  const { data: varieties } = useMangoVarieties()
  const { data: diseases } = useDiseases()

  const totalPages = Math.ceil((data?.count ?? 0) / PAGE_SIZE)

  function resetFilters() {
    setFilters({})
    setPage(1)
  }

  function applyFilter(key: keyof typeof filters, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value || undefined }))
    setPage(1)
  }

  const hasFilters = Object.values(filters).some(Boolean)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">Scan History</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Browse and filter all mango scan sessions.</p>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground mr-1">
              <SlidersHorizontal className="h-4 w-4" />
              Filters
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Verdict</Label>
              <Select value={filters.verdict ?? ''} onValueChange={(v) => applyFilter('verdict', v)}>
                <SelectTrigger className="h-8 w-32 text-xs">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All</SelectItem>
                  <SelectItem value="passed">Passed</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Variety</Label>
              <Select value={filters.varietyId ?? ''} onValueChange={(v) => applyFilter('varietyId', v)}>
                <SelectTrigger className="h-8 w-36 text-xs">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All</SelectItem>
                  {varieties?.map((v) => (
                    <SelectItem key={v.variety_id} value={String(v.variety_id)}>
                      {v.variety_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Disease</Label>
              <Select value={filters.diseaseId ?? ''} onValueChange={(v) => applyFilter('diseaseId', v)}>
                <SelectTrigger className="h-8 w-36 text-xs">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All</SelectItem>
                  {diseases?.map((d) => (
                    <SelectItem key={d.disease_id} value={String(d.disease_id)}>
                      {d.disease_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">From</Label>
              <Input
                type="date"
                className="h-8 w-36 text-xs"
                value={filters.dateFrom ?? ''}
                onChange={(e) => applyFilter('dateFrom', e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">To</Label>
              <Input
                type="date"
                className="h-8 w-36 text-xs"
                value={filters.dateTo ?? ''}
                onChange={(e) => applyFilter('dateTo', e.target.value)}
              />
            </div>

            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={resetFilters} className="h-8 gap-1.5 text-xs">
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </Button>
            )}

            <div className="ml-auto text-sm text-muted-foreground">
              {data?.count ?? 0} scans
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Scan ID</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Date & Time</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Variety</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Disease</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Verdict</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Confidence</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Time (s)</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Bin</th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-border/50">
                      {Array.from({ length: 8 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <Skeleton className="h-4 w-full" />
                        </td>
                      ))}
                    </tr>
                  ))
                : data?.data.map((scan) => (
                    <tr
                      key={scan.scan_id}
                      onClick={() => setSelectedScan(scan)}
                      className={cn(
                        'border-b border-border/50 transition-colors cursor-pointer',
                        'hover:bg-accent/50'
                      )}
                    >
                      <td className="px-4 py-3 font-mono text-muted-foreground">#{scan.scan_id}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {format(new Date(scan.scan_datetime), 'MMM d, HH:mm:ss')}
                      </td>
                      <td className="px-4 py-3">{scan.mango_varieties?.variety_name ?? '—'}</td>
                      <td className="px-4 py-3">{scan.diseases?.disease_name ?? '—'}</td>
                      <td className="px-4 py-3">
                        <VerdictBadge verdict={scan.quality_verdict} />
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {scan.confidence_score != null ? `${scan.confidence_score.toFixed(1)}%` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {scan.processing_time != null ? scan.processing_time.toFixed(2) : '—'}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{scan.bin_assigned ?? '—'}</td>
                    </tr>
                  ))}

              {!isLoading && data?.data.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                    No scans found matching the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <p className="text-xs text-muted-foreground">
              Page {page} of {totalPages}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      <ScanDetailDrawer scan={selectedScan} onClose={() => setSelectedScan(null)} />
    </div>
  )
}
