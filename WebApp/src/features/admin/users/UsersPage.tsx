import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Profile, UserStatus } from '@/lib/database.types'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { toast } from '@/hooks/use-toast'
import { Pencil, UserPlus, Loader2, Eye, EyeOff } from 'lucide-react'
import { format } from 'date-fns'

function useProfiles() {
  return useQuery({
    queryKey: ['profiles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').order('created_at')
      if (error) throw error
      return data as Profile[]
    },
  })
}

// ── Edit existing profile ──────────────────────────────────────────────────

interface ProfileFormValues {
  full_name: string
  username: string
  email: string
  status: UserStatus
}

function EditProfileDialog({ open, onClose, profile }: { open: boolean; onClose: () => void; profile: Profile }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<ProfileFormValues>({
    full_name: profile.full_name,
    username: profile.username,
    email: profile.email ?? '',
    status: profile.status,
  })

  const mutation = useMutation({
    mutationFn: async (values: ProfileFormValues) => {
      const { error } = await supabase.from('profiles').update(values).eq('id', profile.id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] })
      toast({ title: 'Profile updated', variant: 'success' })
      onClose()
    },
    onError: (err: Error) => {
      toast({ title: 'Update failed', description: err.message, variant: 'destructive' })
    },
  })

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit — {profile.full_name}</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(form) }} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="full_name">Full Name</Label>
              <Input id="full_name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="username">Username</Label>
              <Input id="username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as UserStatus })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Separator />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Create new user ────────────────────────────────────────────────────────

interface CreateUserValues {
  full_name: string
  username: string
  email: string
  password: string
}

function CreateUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<CreateUserValues>({ full_name: '', username: '', email: '', password: '' })
  const [showPassword, setShowPassword] = useState(false)

  const mutation = useMutation({
    mutationFn: async (values: CreateUserValues) => {
      // Use a separate client so the admin's session isn't touched
      const tempClient = createClient(
        import.meta.env.VITE_SUPABASE_URL as string,
        import.meta.env.VITE_SUPABASE_ANON_KEY as string,
        { auth: { persistSession: false, autoRefreshToken: false } },
      )
      const { data, error } = await tempClient.auth.signUp({
        email: values.email,
        password: values.password,
        options: { data: { full_name: values.full_name } },
      })
      if (error) throw error
      if (!data.user) throw new Error('User creation failed.')

      // Trigger (migration 004) auto-creates the profiles row; update username + full_name
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ username: values.username, full_name: values.full_name })
        .eq('id', data.user.id)
      if (profileError) throw profileError
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] })
      toast({ title: 'User created successfully', variant: 'success' })
      setForm({ full_name: '', username: '', email: '', password: '' })
      onClose()
    },
    onError: (err: Error) => {
      toast({ title: 'Failed to create user', description: err.message, variant: 'destructive' })
    },
  })

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New User</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(form) }} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="new_full_name">Full Name</Label>
              <Input
                id="new_full_name"
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new_username">Username</Label>
              <Input
                id="new_username"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                required
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new_email">Email</Label>
            <Input
              id="new_email"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new_password">Password</Label>
            <div className="relative">
              <Input
                id="new_password"
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
                minLength={8}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">Minimum 8 characters.</p>
          </div>
          <Separator />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Create User
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function UsersPage() {
  const { data: profiles, isLoading } = useProfiles()
  const [editing, setEditing] = useState<Profile | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Users</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage system accounts.
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
          <UserPlus className="h-4 w-4" />
          Create User
        </Button>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Username</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Email</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Last Login</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i} className="border-b border-border/50">
                      {Array.from({ length: 6 }).map((_, j) => (
                        <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                      ))}
                    </tr>
                  ))
                : profiles?.map((p) => (
                    <tr key={p.id} className="border-b border-border/50 hover:bg-accent/30 transition-colors">
                      <td className="px-4 py-3 font-medium">{p.full_name}</td>
                      <td className="px-4 py-3 font-mono text-muted-foreground">{p.username}</td>
                      <td className="px-4 py-3 text-muted-foreground">{p.email ?? '—'}</td>
                      <td className="px-4 py-3">
                        <Badge variant={p.status === 'active' ? 'success' : 'secondary'} className="capitalize">{p.status}</Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {p.last_login ? format(new Date(p.last_login), 'MMM d, HH:mm') : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 cursor-pointer"
                          onClick={() => setEditing(p)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
              {!isLoading && profiles?.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                    No user profiles yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <CreateUserDialog open={createOpen} onClose={() => setCreateOpen(false)} />

      {editing && (
        <EditProfileDialog
          open={true}
          onClose={() => setEditing(null)}
          profile={editing}
        />
      )}
    </div>
  )
}
