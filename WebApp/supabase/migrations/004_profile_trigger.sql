-- Migration 004: Auto-create a profiles row when a Supabase Auth user is created

create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username, full_name, email, role, status)
  values (
    new.id,
    split_part(new.email, '@', 1),
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email,
    'admin',
    'active'
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();
