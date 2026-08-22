import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from '@/components/ui/toaster'
import AppShell from '@/components/layout/AppShell'
import MonitorPage from '@/features/monitor/MonitorPage'
import ScansPage from '@/features/scans/ScansPage'
import AnalyticsPage from '@/features/analytics/AnalyticsPage'
import ClassificationPage from '@/features/admin/classification/ClassificationPage'

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
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<MonitorPage />} />
            <Route path="/scans" element={<ScansPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />

            <Route path="/admin/classification" element={<ClassificationPage />} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
        <Toaster />
      </BrowserRouter>
    </QueryClientProvider>
  )
}
