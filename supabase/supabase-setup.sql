-- Climbing to You · Supabase setup
-- Run this whole file once in Supabase > SQL Editor.

begin;

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Climber'
    check (char_length(display_name) between 1 and 60),
  partner_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint profiles_partner_is_someone_else
    check (partner_id is null or partner_id <> id)
);

create table if not exists public.voice_notes (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  file_path text not null unique,
  duration_seconds integer not null default 1
    check (duration_seconds between 1 and 300),
  created_at timestamptz not null default now(),
  listened_at timestamptz,
  constraint voice_notes_two_different_people
    check (sender_id <> recipient_id)
);

create index if not exists voice_notes_recipient_created_idx
  on public.voice_notes (recipient_id, created_at desc);

create index if not exists voice_notes_sender_created_idx
  on public.voice_notes (sender_id, created_at desc);

create or replace function public.handle_new_climber()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), 'Climber')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_climbing on auth.users;
create trigger on_auth_user_created_climbing
  after insert on auth.users
  for each row execute procedure public.handle_new_climber();

-- If accounts existed before this script was installed, add their profiles too.
insert into public.profiles (id, display_name)
select
  users.id,
  coalesce(
    nullif(users.raw_user_meta_data ->> 'display_name', ''),
    split_part(users.email, '@', 1),
    'Climber'
  )
from auth.users as users
on conflict (id) do nothing;

alter table public.profiles enable row level security;
alter table public.voice_notes enable row level security;

revoke all on public.profiles from anon, authenticated;
revoke all on public.voice_notes from anon, authenticated;

grant select on public.profiles to authenticated;
grant select, insert, delete on public.voice_notes to authenticated;
grant update (listened_at) on public.voice_notes to authenticated;

drop policy if exists "Climbers can read their own profile" on public.profiles;
create policy "Climbers can read their own profile"
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "Pair members can read their voice notes" on public.voice_notes;
create policy "Pair members can read their voice notes"
  on public.voice_notes
  for select
  to authenticated
  using (
    (select auth.uid()) = sender_id
    or (select auth.uid()) = recipient_id
  );

drop policy if exists "Climbers can send only to their partner" on public.voice_notes;
create policy "Climbers can send only to their partner"
  on public.voice_notes
  for insert
  to authenticated
  with check (
    sender_id = (select auth.uid())
    and recipient_id = (
      select profiles.partner_id
      from public.profiles
      where profiles.id = (select auth.uid())
    )
  );

drop policy if exists "Recipients can mark notes listened" on public.voice_notes;
create policy "Recipients can mark notes listened"
  on public.voice_notes
  for update
  to authenticated
  using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));

drop policy if exists "Senders can delete their notes" on public.voice_notes;
create policy "Senders can delete their notes"
  on public.voice_notes
  for delete
  to authenticated
  using (sender_id = (select auth.uid()));

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'voice-notes',
  'voice-notes',
  false,
  15728640,
  array[
    'audio/webm',
    'audio/ogg',
    'audio/mp4',
    'audio/mpeg',
    'audio/wav',
    'audio/aac',
    'audio/x-m4a'
  ]
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Pair members can hear private voice files" on storage.objects;
create policy "Pair members can hear private voice files"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'voice-notes'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (storage.foldername(name))[2] = (select auth.uid())::text
    )
  );

drop policy if exists "Climbers can upload only to their partner folder" on storage.objects;
create policy "Climbers can upload only to their partner folder"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'voice-notes'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (storage.foldername(name))[2] = (
      select profiles.partner_id::text
      from public.profiles
      where profiles.id = (select auth.uid())
    )
  );

drop policy if exists "Senders can delete their private voice files" on storage.objects;
create policy "Senders can delete their private voice files"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'voice-notes'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Run this function from the SQL Editor after both people create accounts.
-- It is not callable from the public website.
create or replace function public.pair_climbers(
  first_email text,
  second_email text
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  first_id uuid;
  second_id uuid;
begin
  select id into first_id
  from auth.users
  where lower(email) = lower(first_email)
  limit 1;

  select id into second_id
  from auth.users
  where lower(email) = lower(second_email)
  limit 1;

  if first_id is null or second_id is null then
    raise exception 'Both people must create their accounts before pairing.';
  end if;

  if first_id = second_id then
    raise exception 'Use two different email accounts.';
  end if;

  update public.profiles set partner_id = second_id where id = first_id;
  update public.profiles set partner_id = first_id where id = second_id;
end;
$$;

revoke all on function public.pair_climbers(text, text)
  from public, anon, authenticated;

do $$
begin
  alter publication supabase_realtime add table public.voice_notes;
exception
  when duplicate_object then null;
end;
$$;

commit;

