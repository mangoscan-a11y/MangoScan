import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { MangoVariety } from '@/lib/database.types'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Pencil, Plus } from 'lucide-react'

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

export default function VarietiesPage() {
  const { data: varieties, isLoading } = useVarieties()
  const [_editing, _setEditing] = useState<MangoVariety | null>(null)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Mango Varieties</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Variety classes the YOLOv8 model is trained to detect.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground italic">Not available for now</span>
          <Button size="sm" className="gap-1.5" disabled>
            <Plus className="h-4 w-4" /> Add Variety
          </Button>
        </div>
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
                    <tr key={v.variety_id} className="border-b border-border/50">
                      <td className="px-4 py-3 font-medium">{v.variety_name}</td>
                      <td className="px-4 py-3 text-muted-foreground max-w-xs truncate">{v.description ?? '—'}</td>
                      <td className="px-4 py-3 text-right font-mono">
                        {v.market_price != null ? `₱${v.market_price.toFixed(2)}/kg` : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <Button variant="ghost" size="icon" className="h-7 w-7" disabled>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
