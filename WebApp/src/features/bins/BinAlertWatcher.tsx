import { useEffect, useRef } from 'react'
import { toast } from '@/hooks/use-toast'
import { useMachineStatus } from '@/features/machine/hooks'
import type { BinStatus } from '@/lib/database.types'
import { binLabel, diffBins } from './bin-alerts'
import { armAudioUnlock, isMuted, notifyDesktop, playAlertBeep } from './bin-sound'

/**
 * Watches bin state and raises a one-off alert the moment a bin fills (toast, beep and, when
 * the window is in the background, a desktop notification). The persistent banner is separate.
 */
export function BinAlertWatcher() {
  const { data } = useMachineStatus()
  const previous = useRef<BinStatus[] | null>(null)

  useEffect(() => {
    armAudioUnlock()
  }, [])

  useEffect(() => {
    if (!data) return
    const { nowFull, nowEmpty } = diffBins(previous.current, data.bins)
    previous.current = data.bins

    for (const bin of nowFull) {
      const label = binLabel(bin.bin_index)
      toast({
        variant: 'destructive',
        title: label + ' is full',
        description: 'Empty it so sorting can continue.',
      })
      notifyDesktop('MangoScan: ' + label + ' is full', 'Empty the bin so sorting can continue.')
    }
    if (nowFull.length > 0 && !isMuted()) playAlertBeep()

    for (const bin of nowEmpty) {
      toast({ title: binLabel(bin.bin_index) + ' emptied', description: 'Sorting into it can resume.' })
    }
  }, [data])

  return null
}
