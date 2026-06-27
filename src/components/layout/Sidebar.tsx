import { NavLink } from 'react-router-dom'
import { Monitor, History, BarChart3, Users, Database, ScanLine, LogOut, User } from 'lucide-react'
import { useAuth } from '@/features/auth/AuthProvider'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

const navItems = [
  { to: '/',                 icon: Monitor,  label: 'Live Monitor' },
  { to: '/scans',            icon: History,  label: 'Scan History' },
  { to: '/analytics',        icon: BarChart3, label: 'Analytics' },
  { to: '/admin/users',      icon: Users,    label: 'Users' },
  { to: '/admin/varieties',  icon: Database, label: 'Varieties' },
  { to: '/admin/diseases',   icon: Database, label: 'Diseases' },
]

export function Sidebar() {
  const { profile, signOut } = useAuth()
  if (!profile) return null

  return (
    <aside className="flex h-screen w-56 flex-col border-r border-border bg-card">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-5 border-b border-border">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
          <ScanLine className="h-4 w-4 text-primary" />
        </div>
        <span className="font-semibold text-sm">MangoScan</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 p-3">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors cursor-pointer',
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-border p-3 space-y-1">
        <NavLink
          to="/profile"
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors cursor-pointer',
              isActive
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            )
          }
        >
          <User className="h-4 w-4 shrink-0" />
          <span className="truncate">{profile.full_name}</span>
        </NavLink>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-3 text-muted-foreground hover:text-destructive"
          onClick={signOut}
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </div>
    </aside>
  )
}
