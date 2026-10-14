import { AlertTriangle } from 'lucide-react'
import { format } from 'date-fns'
import { useMachineStatus } from '@/features/machine/hooks'
import { binLabel, fullBins } from './bin-alerts'

/** Stays on every page until the machine reports the bin empty again. It cannot be dismissed. */
export function BinFullBanner() {
  const { data } = useMachineStatus()
  const full = data ? fullBins(data.bins) : []
  if (full.length === 0) return null

  const many = full.length > 1
  return (
    <div role="alert" className="shrink-0 border-b border-destructive/40 bg-destructive/10 px-6 py-3">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-destructive">
            {many ? full.length + ' bins are full.' : '1 bin is full.'} Empty {many ? 'them' : 'it'} so sorting can continue.
          </p>
          <ul className="text-sm text-foreground">
            {full.map((b) => (
              <li key={b.bin_index}>
                <span className="font-medium">{binLabel(b.bin_index)}</span>
                {b.full_since && (
                  <span className="text-muted-foreground"> · full since {format(new Date(b.full_since), 'HH:mm')}</span>
                )}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">This clears by itself once the bin sensor reads empty.</p>
        </div>
      </div>
    </div>
  )
}
