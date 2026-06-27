import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { Toaster } from '@/components/ui/toaster'
import AppShell from '@/components/layout/AppShell'
import LoginPage from '@/features/auth/LoginPage'
import MonitorPage from '@/features/monitor/MonitorPage'
import ScansPage from '@/features/scans/ScansPage'
import AnalyticsPage from '@/features/analytics/AnalyticsPage'
import UsersPage from '@/features/admin/users/UsersPage'
import VarietiesPage from '@/features/admin/varieties/VarietiesPage'
import DiseasesPage from '@/features/admin/diseases/DiseasesPage'
import ProfilePage from '@/features/profile/ProfilePage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />

            <Route element={<AppShell />}>
              <Route path="/" element={<MonitorPage />} />
              <Route path="/scans" element={<ScansPage />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
              <Route path="/profile" element={<ProfilePage />} />

              <Route path="/admin/users" element={<UsersPage />} />
              <Route path="/admin/varieties" element={<VarietiesPage />} />
              <Route path="/admin/diseases" element={<DiseasesPage />} />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
          <Toaster />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
