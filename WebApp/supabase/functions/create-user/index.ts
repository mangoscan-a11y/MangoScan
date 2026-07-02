import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const { email, password, full_name, username } = await req.json()

  if (!email || !password || !full_name || !username) {
    return Response.json({ error: 'email, password, full_name, and username are required' }, { status: 400, headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
  })

  if (error) return Response.json({ error: error.message }, { status: 400, headers: corsHeaders })

  // Trigger auto-creates the profile row, but we override username/full_name
  if (data.user) {
    await supabase
      .from('profiles')
      .update({ username, full_name })
      .eq('id', data.user.id)
  }

  return Response.json({ user: { id: data.user?.id, email } }, { headers: corsHeaders })
})
