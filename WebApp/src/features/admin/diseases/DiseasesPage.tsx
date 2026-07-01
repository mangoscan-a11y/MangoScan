import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Disease, SeverityLevel } from '@/lib/database.types'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { toast } from '@/hooks/use-toast'
import { Pencil, Plus, Loader2 } from 'lucide-react'

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

const severityColor: Record<SeverityLevel, 'default' | 'secondary' | 'warning' | 'destructive' | 'success'> = {
  none: 'success',
  low: 'secondary',
  moderate: 'warning',
  high: 'destructive',
}

function DiseaseFormDialog({ open, onClose, disease }: { open: boolean; onClose: () => void; disease: Disease | null }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    disease_name: disease?.disease_name ?? '',
    description: disease?.description ?? '',
    severity_level: disease?.severity_level ?? 'none' as SeverityLevel,
  })

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        disease_name: form.disease_name,
        description: form.description || null,
        severity_level: form.severity_level,
      }
      if (disease) {
        const { error } = await supabase.from('diseases').update(payload).eq('disease_id', disease.disease_id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('diseases').insert(payload)
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['diseases'] })
      toast({ title: disease ? 'Disease updated' : 'Disease created', variant: 'success' })
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
          <DialogTitle>{disease ? `Edit — ${disease.disease_name}` : 'New Disease Class'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); mutation.mutate() }} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="disease_name">Name</Label>
            <Input id="disease_name" value={form.disease_name} onChange={(e) => setForm({ ...form, disease_name: e.target.value })} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Input id="description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional" />
          </div>
          <div className="space-y-1.5">
            <Label>Severity Level</Label>
            <Select value={form.severity_level} onValueChange={(v) => setForm({ ...form, severity_level: v as SeverityLevel })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None (Healthy)</SelectItem>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="moderate">Moderate</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Separator />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {disease ? 'Save Changes' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function DiseasesPage() {
  const { data: diseases, isLoading } = useDiseases()
  const [editing, setEditing] = useState<Disease | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Disease Classes</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Reference data for disease detection classification.</p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => { setEditing(null); setDialogOpen(true) }}>
          <Plus className="h-4 w-4" /> Add Disease
        </Button>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Description</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Severity</th>
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
                : diseases?.map((d) => (
                    <tr key={d.disease_id} className="border-b border-border/50 hover:bg-accent/30 transition-colors">
                      <td className="px-4 py-3 font-medium">{d.disease_name}</td>
                      <td className="px-4 py-3 text-muted-foreground max-w-xs truncate">{d.description ?? '—'}</td>
                      <td className="px-4 py-3">
                        <Badge variant={severityColor[d.severity_level]} className="capitalize">{d.severity_level}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditing(d); setDialogOpen(true) }}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </Card>

      <DiseaseFormDialog open={dialogOpen} onClose={() => { setDialogOpen(false); setEditing(null) }} disease={editing} />
    </div>
  )
}
