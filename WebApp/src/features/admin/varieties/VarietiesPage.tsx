import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { MangoVariety } from '@/lib/database.types'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { toast } from '@/hooks/use-toast'
import { Pencil, Plus, Loader2 } from 'lucide-react'

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

interface VarietyFormValues {
  variety_name: string
  description: string
  market_price: string
}

function VarietyFormDialog({ open, onClose, variety }: { open: boolean; onClose: () => void; variety: MangoVariety | null }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<VarietyFormValues>({
    variety_name: variety?.variety_name ?? '',
    description: variety?.description ?? '',
    market_price: variety?.market_price?.toString() ?? '',
  })

  const mutation = useMutation({
    mutationFn: async (values: VarietyFormValues) => {
      const payload = {
        variety_name: values.variety_name,
        description: values.description || null,
        market_price: values.market_price ? parseFloat(values.market_price) : null,
      }
      if (variety) {
        const { error } = await supabase.from('mango_varieties').update(payload).eq('variety_id', variety.variety_id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('mango_varieties').insert(payload)
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mango_varieties'] })
      toast({ title: variety ? 'Variety updated' : 'Variety created', variant: 'success' })
      onClose()
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' })
    },
  })

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{variety ? `Edit — ${variety.variety_name}` : 'New Variety'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(form) }} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="variety_name">Name</Label>
            <Input id="variety_name" value={form.variety_name} onChange={(e) => setForm({ ...form, variety_name: e.target.value })} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Input id="description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="market_price">Market Price (₱/kg)</Label>
            <Input id="market_price" type="number" step="0.01" value={form.market_price} onChange={(e) => setForm({ ...form, market_price: e.target.value })} placeholder="0.00" />
          </div>
          <Separator />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {variety ? 'Save Changes' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function VarietiesPage() {
  const { data: varieties, isLoading } = useVarieties()
  const [editing, setEditing] = useState<MangoVariety | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Mango Varieties</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Reference data for mango variety classification.</p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => { setEditing(null); setDialogOpen(true) }}>
          <Plus className="h-4 w-4" /> Add Variety
        </Button>
      </div>

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
              {isLoading
                ? Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i} className="border-b border-border/50">
                      {[1, 2, 3, 4].map((j) => <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>)}
                    </tr>
                  ))
                : varieties?.map((v) => (
                    <tr key={v.variety_id} className="border-b border-border/50 hover:bg-accent/30 transition-colors">
                      <td className="px-4 py-3 font-medium">{v.variety_name}</td>
                      <td className="px-4 py-3 text-muted-foreground max-w-xs truncate">{v.description ?? '—'}</td>
                      <td className="px-4 py-3 text-right font-mono">
                        {v.market_price != null ? `₱${v.market_price.toFixed(2)}/kg` : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditing(v); setDialogOpen(true) }}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </Card>

      <VarietyFormDialog open={dialogOpen} onClose={() => { setDialogOpen(false); setEditing(null) }} variety={editing} />
    </div>
  )
}
