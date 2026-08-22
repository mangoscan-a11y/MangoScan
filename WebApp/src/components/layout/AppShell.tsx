import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'

export default function AppShell() {
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
