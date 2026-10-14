import { ThemeToggle } from '@/components/theme-toggle'
import { AlertsToggle } from './AlertsToggle'
import { LiveIndicator } from './LiveIndicator'

export function Header() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-6">
      <LiveIndicator />
      <div className="flex items-center gap-1">
        <AlertsToggle />
        <ThemeToggle />
      </div>
    </header>
  )
}
