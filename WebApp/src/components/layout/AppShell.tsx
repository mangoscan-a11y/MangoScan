import { Outlet, Navigate } from 'react-router-dom'
import { useAuth } from '@/features/auth/AuthProvider'
import { Sidebar } from './Sidebar'
import { Skeleton } from '@/components/ui/skeleton'

export default function AppShell() {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="space-y-3 w-64">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
    )
  }

  if (!session) return <Navigate to="/login" replace />

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <main className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="p-6">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
