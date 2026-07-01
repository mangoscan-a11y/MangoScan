import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/AuthProvider'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { toast } from '@/hooks/use-toast'
import { Loader2, User } from 'lucide-react'
import { format } from 'date-fns'

export default function ProfilePage() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const [fullName, setFullName] = useState(profile?.full_name ?? '')
  const [email, setEmail] = useState(profile?.email ?? '')

  const mutation = useMutation({
    mutationFn: async () => {
      if (!profile) return
      const { error } = await supabase
        .from('profiles')
        .update({ full_name: fullName, email: email || null })
        .eq('id', profile.id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] })
      toast({ title: 'Profile updated', variant: 'success' })
    },
    onError: (err: Error) => {
      toast({ title: 'Update failed', description: err.message, variant: 'destructive' })
    },
  })

  if (!profile) return null

  return (
    <div className="max-w-lg space-y-5">
      <div>
        <h1 className="text-xl font-bold">Profile</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Your account information.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3 text-base">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
              <User className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p>{profile.full_name}</p>
              <span className="font-mono text-xs text-muted-foreground">@{profile.username}</span>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-muted-foreground text-xs">Account Created</p>
              <p className="font-medium">{format(new Date(profile.created_at), 'MMM d, yyyy')}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Last Login</p>
              <p className="font-medium">{profile.last_login ? format(new Date(profile.last_login), 'MMM d, HH:mm') : '—'}</p>
            </div>
          </div>

          <Separator />

          <form
            className="space-y-4"
            onSubmit={(e) => { e.preventDefault(); mutation.mutate() }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="full_name">Full Name</Label>
              <Input
                id="full_name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Username</Label>
              <Input value={profile.username} disabled className="opacity-60" />
              <p className="text-xs text-muted-foreground">Username cannot be changed here.</p>
            </div>

            <Button type="submit" disabled={mutation.isPending} className="w-full">
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
