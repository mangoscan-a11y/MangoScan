import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { MangoVariety, Disease, RipenessLevel, SizeGrade, SeverityLevel } from '@/lib/database.types'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { Pencil } from 'lucide-react'

function useVarieties() {
  return useQuery({
    queryKey: ['mango_varieties'],
    queryFn: async () => {
      const { data, error } = await supabase.from('mango_varieties').select('*').order('variety_name')
      if (error) throw error
      return data as MangoVariety[]
    },
  })
}

function useDiseases() {
  return useQuery({
    queryKey: ['diseases'],
    queryFn: async () => {
      const { data, error } = await supabase.from('diseases').select('*').order('disease_name')
      if (error) throw error
      return data as Disease[]
    },
  })
}

function useRipenessLevels() {
  return useQuery({
    queryKey: ['ripeness_levels'],
    queryFn: async () => {
      const { data, error } = await supabase.from('ripeness_levels').select('*').order('sort_order')
      if (error) throw error
      return data as RipenessLevel[]
    },
  })
}

function useSizeGrades() {
  return useQuery({
    queryKey: ['size_grades'],
    queryFn: async () => {
      const { data, error } = await supabase.from('size_grades').select('*').order('sort_order')
      if (error) throw error
      return data as SizeGrade[]
    },
  })
}

const severityColor: Record<SeverityLevel, 'default' | 'secondary' | 'warning' | 'destructive' | 'success'> = {
  none: 'success',
  low: 'secondary',
  moderate: 'warning',
  high: 'destructive',
}

interface TabHeaderProps {
  title: string
  description: string
}

function TabHeader({ title, description }: TabHeaderProps) {
  return (
    <div>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
    </div>
  )
}

function SkeletonRows({ columns }: { columns: number }) {
  return (
    <>
      {Array.from({ length: 3 }).map((_, i) => (
        <tr key={i} className="border-b border-border/50">
          {Array.from({ length: columns }).map((_, j) => (
            <td key={j} className="px-4 py-3">
              <Skeleton className="h-4 w-full" />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

function EditPriceDialog({ variety, onClose }: { variety: MangoVariety; onClose: () => void }) {
  const [price, setPrice] = useState(variety.market_price != null ? String(variety.market_price) : '')
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const mutation = useMutation({
    mutationFn: async (newPrice: number) => {
      const { error } = await supabase
        .from('mango_varieties')
        .update({ market_price: newPrice })
        .eq('variety_id', variety.variety_id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mango_varieties'] })
      toast({ title: 'Market price updated', description: `${variety.variety_name} is now ₱${Number(price).toFixed(2)}/kg.` })
      onClose()
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to update price', description: error.message, variant: 'destructive' })
    },
  })

  const parsed = Number(price)
  const isValid = price.trim() !== '' && Number.isFinite(parsed) && parsed >= 0

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit market price</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (isValid) mutation.mutate(parsed)
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="market-price">{variety.variety_name} (₱/kg)</Label>
            <Input
              id="market-price"
              type="number"
              min="0"
              step="0.01"
              autoFocus
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={!isValid || mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function VarietiesTab() {
  const { data: varieties, isLoading } = useVarieties()
  const [editing, setEditing] = useState<MangoVariety | null>(null)

  return (
    <div className="space-y-4">
      <TabHeader
        title="Mango Varieties"
        description="Variety classes mangoes are manually pre-sorted into before entering the machine."
      />
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Description</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Market Price</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <SkeletonRows columns={4} />
              ) : (
                varieties?.map((v) => (
                  <tr key={v.variety_id} className="border-b border-border/50">
                    <td className="px-4 py-3 font-medium">{v.variety_name}</td>
                    <td className="px-4 py-3 text-muted-foreground max-w-xs truncate">{v.description ?? '—'}</td>
                    <td className="px-4 py-3 text-right font-mono">
                      {v.market_price != null ? `₱${v.market_price.toFixed(2)}/kg` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(v)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
      {editing && <EditPriceDialog variety={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function DiseasesTab() {
  const { data: diseases, isLoading } = useDiseases()

  return (
    <div className="space-y-4">
      <TabHeader
        title="Disease Classes"
        description="Disease classes the YOLOv8 model is trained to detect."
      />
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Description</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Severity</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <SkeletonRows columns={3} />
              ) : (
                diseases?.map((d) => (
                  <tr key={d.disease_id} className="border-b border-border/50">
                    <td className="px-4 py-3 font-medium">{d.disease_name}</td>
                    <td className="px-4 py-3 text-muted-foreground max-w-xs">{d.description ?? '—'}</td>
                    <td className="px-4 py-3">
                      <Badge variant={severityColor[d.severity_level]} className="capitalize">{d.severity_level}</Badge>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function RipenessTab() {
  const { data: levels, isLoading } = useRipenessLevels()

  return (
    <div className="space-y-4">
      <TabHeader
        title="Ripeness Levels (Color)"
        description="Color/ripeness stages the YOLOv8 model reports for each mango."
      />
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Description</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <SkeletonRows columns={2} />
              ) : (
                levels?.map((r) => (
                  <tr key={r.ripeness_id} className="border-b border-border/50">
                    <td className="px-4 py-3 font-medium">{r.ripeness_name}</td>
                    <td className="px-4 py-3 text-muted-foreground max-w-xs">{r.description ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function SizeGradesTab() {
  const { data: grades, isLoading } = useSizeGrades()

  return (
    <div className="space-y-4">
      <TabHeader
        title="Size Grades"
        description="Size classes the YOLOv8 model reports for each mango, graded by weight."
      />
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Description</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Weight Range</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <SkeletonRows columns={3} />
              ) : (
                grades?.map((s) => (
                  <tr key={s.size_id} className="border-b border-border/50">
                    <td className="px-4 py-3 font-medium">{s.size_name}</td>
                    <td className="px-4 py-3 text-muted-foreground max-w-xs truncate">{s.description ?? '—'}</td>
                    <td className="px-4 py-3 text-right font-mono">
                      {s.min_grams != null && s.max_grams != null ? `${s.min_grams}–${s.max_grams} g` : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

const TABS = [
  { key: 'varieties', label: 'Varieties', render: VarietiesTab },
  { key: 'diseases', label: 'Diseases', render: DiseasesTab },
  { key: 'ripeness', label: 'Ripeness (Color)', render: RipenessTab },
  { key: 'sizes', label: 'Size Grades', render: SizeGradesTab },
] as const

type TabKey = (typeof TABS)[number]['key']

export default function ClassificationPage() {
  const [active, setActive] = useState<TabKey>('varieties')
  const ActiveTab = TABS.find((t) => t.key === active)!.render

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">Classification</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Reference data for the five classification dimensions the sorting machine reports on every scan.
          Bruise is a pass/fail flag with no reference table, so it has no tab here.
        </p>
      </div>

      <div className="flex items-center gap-1 border-b border-border">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActive(tab.key)}
            className={cn(
              'px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              active === tab.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <ActiveTab />
    </div>
  )
}
