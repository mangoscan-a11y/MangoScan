import { useState } from 'react'
import { Bell, BellOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { isMuted, playAlertBeep, requestDesktopPermission, setMuted } from '@/features/bins/bin-sound'

/** Mutes or unmutes the bin-full beep. Turning it on also plays a test beep and asks for desktop alerts. */
export function AlertsToggle() {
  const [muted, setMutedState] = useState(isMuted)

  async function toggle() {
    const next = !muted
    setMuted(next)
    setMutedState(next)
    if (!next) {
      playAlertBeep()
      await requestDesktopPermission()
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-pressed={!muted}
      aria-label={muted ? 'Turn bin alert sound on' : 'Mute bin alert sound'}
      title={muted ? 'Bin alert sound is off' : 'Bin alert sound is on'}
    >
      {muted ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
    </Button>
  )
}
