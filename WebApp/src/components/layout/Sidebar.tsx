import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
	Monitor,
	History,
	BarChart3,
	Users,
	Database,
	LogOut,
	User,
} from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogFooter,
} from '@/components/ui/dialog';
import homeLogo from '@/assets/home_logo.png';

const mainNav = [
	{ to: '/', icon: Monitor, label: 'Live Monitor' },
	{ to: '/scans', icon: History, label: 'Scan History' },
	{ to: '/analytics', icon: BarChart3, label: 'Analytics' },
];

const referenceNav = [
	{ to: '/admin/varieties', icon: Database, label: 'Varieties' },
	{ to: '/admin/diseases', icon: Database, label: 'Diseases' },
];

function NavItem({
	to,
	icon: Icon,
	label,
}: {
	to: string;
	icon: React.ElementType;
	label: string;
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
		</NavLink>
	);
}

function SignOutConfirmDialog({
	open,
	onClose,
	onConfirm,
}: {
	open: boolean;
	onClose: () => void;
	onConfirm: () => void;
}) {
	return (
		<Dialog
			open={open}
			onOpenChange={(o) => {
				if (!o) onClose();
			}}
		>
			<DialogContent className='max-w-sm'>
				<DialogHeader>
					<DialogTitle>Sign out?</DialogTitle>
				</DialogHeader>
				<p className='text-sm text-muted-foreground'>
					You will be returned to the login page.
				</p>
				<DialogFooter className='mt-2'>
					<Button variant='outline' onClick={onClose}>
						Cancel
					</Button>
					<Button variant='destructive' onClick={onConfirm}>
						Sign out
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

export function Sidebar() {
	const { profile, signOut } = useAuth();
	const [confirmOpen, setConfirmOpen] = useState(false);

	if (!profile) return null;

	return (
		<aside className='flex h-screen w-56 flex-col border-r border-border bg-card'>
			{/* Logo */}
			<div className='flex items-center px-4 py-3 border-b border-border'>
				<img
					src={homeLogo}
					alt='MangoFacture'
					className='h-12 w-auto object-contain invert [mix-blend-mode:screen]'
				/>
				<span className='font-semibold text-sm'>MangoScan</span>
			</div>

			{/* Nav */}
			<nav className='flex-1 overflow-y-auto p-3 space-y-4'>
				<div className='space-y-1'>
					{mainNav.map((item) => (
						<NavItem key={item.to} {...item} />
					))}
				</div>

				<div>
					<p className='px-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60'>
						Classification
					</p>
					<div className='space-y-1'>
						{referenceNav.map((item) => (
							<NavItem key={item.to} {...item} />
						))}
					</div>
				</div>

				<div>
					<p className='px-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60'>
						Administration
					</p>
					<NavItem to='/admin/users' icon={Users} label='Users' />
				</div>
			</nav>

			{/* Footer */}
			<div className='border-t border-border p-3 space-y-1'>
				<NavLink
					to='/profile'
					className={({ isActive }) =>
						cn(
							'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors cursor-pointer',
							isActive
								? 'bg-primary/10 text-primary'
								: 'text-muted-foreground hover:bg-accent hover:text-foreground',
						)
					}
				>
					<User className='h-4 w-4 shrink-0' />
					<span className='truncate'>{profile.full_name}</span>
				</NavLink>
				<Button
					variant='ghost'
					size='sm'
					className='w-full justify-start gap-3 text-muted-foreground hover:text-destructive'
					onClick={() => setConfirmOpen(true)}
				>
					<LogOut className='h-4 w-4' />
					Sign out
				</Button>
			</div>

			<SignOutConfirmDialog
				open={confirmOpen}
				onClose={() => setConfirmOpen(false)}
				onConfirm={() => {
					setConfirmOpen(false);
					signOut();
				}}
			/>
		</aside>
	);
}
