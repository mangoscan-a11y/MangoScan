import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { BinAlertWatcher } from '@/features/bins/BinAlertWatcher'
import { BinFullBanner } from '@/features/bins/BinFullBanner'
import { useLiveEvents } from '@/features/machine/live-events'

export default function AppShell() {
  useLiveEvents()

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <BinFullBanner />
        <main className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="p-6">
            <Outlet />
          </div>
        </main>
      </div>
      <BinAlertWatcher />
    </div>
  )
}
