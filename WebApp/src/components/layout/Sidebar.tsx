import { NavLink } from 'react-router-dom';
import {
	Monitor,
	History,
	BarChart3,
	Database,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import homeLogo from '@/assets/home_logo.png';
import { useMachineStatus } from '@/features/machine/hooks';
import { fullBins } from '@/features/bins/bin-alerts';

const mainNav = [
	{ to: '/', icon: Monitor, label: 'Live Monitor' },
	{ to: '/scans', icon: History, label: 'Scan History' },
	{ to: '/analytics', icon: BarChart3, label: 'Analytics' },
	{ to: '/admin/classification', icon: Database, label: 'Classification' },
];

function NavItem({
	to,
	icon: Icon,
	label,
	alertCount = 0,
}: {
	to: string;
	icon: React.ElementType;
	label: string;
	alertCount?: number;
}) {
	return (
		<NavLink
			to={to}
			end={to === '/'}
			className={({ isActive }) =>
				cn(
					'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors cursor-pointer',
					isActive
						? 'bg-primary/10 text-primary'
						: 'text-muted-foreground hover:bg-accent hover:text-foreground',
				)
			}
		>
			<Icon className='h-4 w-4 shrink-0' />
			{label}
			{alertCount > 0 && (
				<span
					className='ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-xs font-semibold text-destructive-foreground'
					aria-label={`${alertCount} full ${alertCount === 1 ? 'bin' : 'bins'}`}
				>
					{alertCount}
				</span>
			)}
		</NavLink>
	);
}

export function Sidebar() {
	const { data } = useMachineStatus();
	const fullCount = data ? fullBins(data.bins).length : 0;

	return (
		<aside className='flex h-screen w-56 flex-col border-r border-border bg-card'>
			{/* Logo */}
			<div className='flex items-center px-4 py-3 border-b border-border'>
				<img
					src={homeLogo}
					alt='MangoFacture'
					className='h-12 w-auto object-contain dark:invert dark:[mix-blend-mode:screen]'
				/>
				<span className='font-semibold text-sm'>MangoScan</span>
			</div>

			{/* Nav */}
			<nav className='flex-1 overflow-y-auto p-3 space-y-4'>
				<div className='space-y-1'>
					{mainNav.map((item) => (
						<NavItem key={item.to} {...item} alertCount={item.to === '/' ? fullCount : 0} />
					))}
				</div>
			</nav>
		</aside>
	);
}
