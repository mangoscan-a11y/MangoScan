import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Profile, UserStatus } from '@/lib/database.types';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogFooter,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { toast } from '@/hooks/use-toast';
import { Pencil, UserPlus, Loader2 } from 'lucide-react';
import { format } from 'date-fns';

function useProfiles() {
	return useQuery({
		queryKey: ['profiles'],
		queryFn: async () => {
			const { data, error } = await supabase
				.from('profiles')
				.select('*')
				.order('created_at');
			if (error) throw error;
			return data as Profile[];
		},
	});
}

interface ProfileFormValues {
	full_name: string;
	username: string;
	email: string;
	status: UserStatus;
}

function ProfileFormDialog({
	open,
	onClose,
	profile,
}: {
	open: boolean;
	onClose: () => void;
	profile: Profile | null;
}) {
	const queryClient = useQueryClient();
	const [form, setForm] = useState<ProfileFormValues>({
		full_name: profile?.full_name ?? '',
		username: profile?.username ?? '',
		email: profile?.email ?? '',
		status: profile?.status ?? 'active',
	});

	const mutation = useMutation({
		mutationFn: async (values: ProfileFormValues) => {
			if (!profile) return;
			const { error } = await supabase
				.from('profiles')
				.update(values)
				.eq('id', profile.id);
			if (error) throw error;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['profiles'] });
			toast({ title: 'Profile updated', variant: 'success' });
			onClose();
		},
		onError: (err: Error) => {
			toast({
				title: 'Update failed',
				description: err.message,
				variant: 'destructive',
			});
		},
	});

	return (
		<Dialog
			open={open}
			onOpenChange={(o) => {
				if (!o) onClose();
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{profile ? `Edit — ${profile.full_name}` : 'New User'}
					</DialogTitle>
				</DialogHeader>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						mutation.mutate(form);
					}}
					className='space-y-4'
				>
					<div className='grid grid-cols-2 gap-3'>
						<div className='space-y-1.5'>
							<Label htmlFor='full_name'>Full Name</Label>
							<Input
								id='full_name'
								value={form.full_name}
								onChange={(e) =>
									setForm({ ...form, full_name: e.target.value })
								}
								required
							/>
						</div>
						<div className='space-y-1.5'>
							<Label htmlFor='username'>Username</Label>
							<Input
								id='username'
								value={form.username}
								onChange={(e) => setForm({ ...form, username: e.target.value })}
								required
							/>
						</div>
					</div>
					<div className='space-y-1.5'>
						<Label htmlFor='email'>Email</Label>
						<Input
							id='email'
							type='email'
							value={form.email}
							onChange={(e) => setForm({ ...form, email: e.target.value })}
						/>
					</div>
					<div className='space-y-1.5'>
						<Label>Status</Label>
						<Select
							value={form.status}
							onValueChange={(v) =>
								setForm({ ...form, status: v as UserStatus })
							}
						>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value='active'>Active</SelectItem>
								<SelectItem value='inactive'>Inactive</SelectItem>
							</SelectContent>
						</Select>
					</div>
					<Separator />
					<DialogFooter>
						<Button type='button' variant='outline' onClick={onClose}>
							Cancel
						</Button>
						<Button type='submit' disabled={mutation.isPending}>
							{mutation.isPending && (
								<Loader2 className='h-4 w-4 animate-spin' />
							)}
							Save Changes
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

export default function UsersPage() {
	const { data: profiles, isLoading } = useProfiles();
	const [editing, setEditing] = useState<Profile | null>(null);
	const [dialogOpen, setDialogOpen] = useState(false);

	return (
		<div className='space-y-5'>
			<div className='flex items-center justify-between'>
				<div>
					<h1 className='text-xl font-bold'>Users</h1>
					<p className='text-sm text-muted-foreground mt-0.5'>
						Manage system accounts. New users must first be created via Supabase
						Auth, then their profile appears here.
					</p>
				</div>
				<Button
					size='sm'
					variant='outline'
					className='gap-1.5'
					onClick={() => {
						setEditing(null);
						setDialogOpen(true);
					}}
				>
					<UserPlus className='h-4 w-4' />
					Create User
				</Button>
			</div>

			<Card>
				<div className='overflow-x-auto'>
					<table className='w-full text-sm'>
						<thead>
							<tr className='border-b border-border'>
								<th className='px-4 py-3 text-left font-medium text-muted-foreground'>
									Name
								</th>
								<th className='px-4 py-3 text-left font-medium text-muted-foreground'>
									Username
								</th>
								<th className='px-4 py-3 text-left font-medium text-muted-foreground'>
									Email
								</th>
								<th className='px-4 py-3 text-left font-medium text-muted-foreground'>
									Role
								</th>
								<th className='px-4 py-3 text-left font-medium text-muted-foreground'>
									Status
								</th>
								<th className='px-4 py-3 text-left font-medium text-muted-foreground'>
									Last Login
								</th>
								<th className='px-4 py-3' />
							</tr>
						</thead>
						<tbody>
							{isLoading
								? Array.from({ length: 3 }).map((_, i) => (
										<tr key={i} className='border-b border-border/50'>
											{Array.from({ length: 7 }).map((_, j) => (
												<td key={j} className='px-4 py-3'>
													<Skeleton className='h-4 w-full' />
												</td>
											))}
										</tr>
									))
								: profiles?.map((p) => (
										<tr
											key={p.id}
											className='border-b border-border/50 hover:bg-accent/30 transition-colors'
										>
											<td className='px-4 py-3 font-medium'>{p.full_name}</td>
											<td className='px-4 py-3 font-mono text-muted-foreground'>
												{p.username}
											</td>
											<td className='px-4 py-3 text-muted-foreground'>
												{p.email ?? '—'}
											</td>
											<td className='px-4 py-3'>
												<Badge variant='secondary' className='capitalize'>
													Admin
												</Badge>
											</td>
											<td className='px-4 py-3'>
												<Badge
													variant={
														p.status === 'active' ? 'success' : 'secondary'
													}
													className='capitalize'
												>
													{p.status}
												</Badge>
											</td>
											<td className='px-4 py-3 text-muted-foreground text-xs'>
												{p.last_login
													? format(new Date(p.last_login), 'MMM d, HH:mm')
													: '—'}
											</td>
											<td className='px-4 py-3'>
												<Button
													variant='ghost'
													size='icon'
													className='h-7 w-7 cursor-pointer'
													onClick={() => {
														setEditing(p);
														setDialogOpen(true);
													}}
												>
													<Pencil className='h-3.5 w-3.5' />
												</Button>
											</td>
										</tr>
									))}
							{!isLoading && profiles?.length === 0 && (
								<tr>
									<td
										colSpan={7}
										className='px-4 py-12 text-center text-muted-foreground'
									>
										No user profiles yet. Create users via Supabase Auth
										Dashboard, then seed their profiles.
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			</Card>

			<ProfileFormDialog
				open={dialogOpen}
				onClose={() => {
					setDialogOpen(false);
					setEditing(null);
				}}
				profile={editing}
			/>
		</div>
	);
}
