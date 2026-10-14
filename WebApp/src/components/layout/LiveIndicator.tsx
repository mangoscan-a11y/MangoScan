import { useLiveConnection } from '@/features/machine/live-events'
import { cn } from '@/lib/utils'

export function LiveIndicator() {
  const live = useLiveConnection()
  return (
    <span
      role="status"
      className="flex items-center gap-2 text-xs text-muted-foreground"
      title={live ? 'Receiving live updates from the machine' : 'Lost the connection to the server. Retrying.'}
    >
      <span className={cn('h-2 w-2 rounded-full', live ? 'bg-success' : 'animate-pulse bg-warning')} aria-hidden />
      {live ? 'Live' : 'Reconnecting…'}
    </span>
  )
}
