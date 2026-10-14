import { format } from 'date-fns'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useMachineStatus } from '@/features/machine/hooks'
import { cn } from '@/lib/utils'
import { binLabel } from './bin-alerts'

export function BinGrid() {
  const { data, isLoading } = useMachineStatus()

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {isLoading || !data
        ? Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)
        : data.bins.map((bin) => (
            <Card key={bin.bin_index} className={cn(bin.full && 'border-destructive bg-destructive/10')}>
              <CardContent className="space-y-1 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{binLabel(bin.bin_index)}</p>
                  <Badge variant={bin.full ? 'destructive' : 'success'}>{bin.full ? 'Full' : 'OK'}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {bin.full && bin.full_since ? 'Full since ' + format(new Date(bin.full_since), 'HH:mm') : 'Has room'}
                </p>
              </CardContent>
            </Card>
          ))}
    </div>
  )
}
