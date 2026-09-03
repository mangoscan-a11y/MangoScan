import { ThemeToggle } from '@/components/theme-toggle'

export function Header() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-end border-b border-border px-6">
      <ThemeToggle />
    </header>
  )
}
