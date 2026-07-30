-- Climbing to You · 24-hour guest links
-- Run this whole file once in Supabase > SQL Editor.
-- It adds temporary, one-person invitation links without exposing raw tokens.

begin;

create table if not exists public.guest_invites (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique
    check (
      char_length(token_hash) = 64
      and token_hash ~ '^[0-9a-f]{64}$'
    ),
  creator_id uuid not null references public.profiles(id) on delete cascade,
  guest_id uuid references public.profiles(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now(),
  constraint guest_invite_uses_two_people
    check (guest_id is null or guest_id <> creator_id)
);

create table if not exists public.guest_voice_notes (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null references public.guest_invites(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  file_path text not null unique,
  duration_seconds integer not null default 1
    check (duration_seconds between 1 and 300),
  created_at timestamptz not null default now(),
  listened_at timestamptz
);

create index if not exists guest_invites_creator_created_idx
  on public.guest_invites (creator_id, created_at desc);

create index if not exists guest_invites_guest_expires_idx
  on public.guest_invites (guest_id, expires_at desc);

create index if not exists guest_voice_notes_invite_created_idx
  on public.guest_voice_notes (invite_id, created_at desc);

alter table public.guest_invites enable row level security;
alter table public.guest_voice_notes enable row level security;

revoke all on public.guest_invites from anon, authenticated;
revoke all on public.guest_voice_notes from anon, authenticated;

grant select (
  id,
  creator_id,
  guest_id,
  expires_at,
  created_at
) on public.guest_invites to authenticated;

grant select, insert, delete on public.guest_voice_notes to authenticated;
grant update (listened_at) on public.guest_voice_notes to authenticated;

-- This helper is intentionally security definer so Storage policies can check
-- membership without depending on nested table RLS.
create or replace function public.is_guest_invite_member(check_invite_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.guest_invites as invite
    where invite.id::text = check_invite_id
      and invite.expires_at > now()
      and (
        invite.creator_id = (select auth.uid())
        or invite.guest_id = (select auth.uid())
      )
  );
$$;

revoke all on function public.is_guest_invite_member(text)
  from public, anon;
grant execute on function public.is_guest_invite_member(text)
  to authenticated;

drop policy if exists "Invite members can read active invites"
  on public.guest_invites;
create policy "Invite members can read active invites"
  on public.guest_invites
  for select
  to authenticated
  using (
    expires_at > now()
    and (
      creator_id = (select auth.uid())
      or guest_id = (select auth.uid())
    )
  );

drop policy if exists "Invite members can read temporary voice notes"
  on public.guest_voice_notes;
create policy "Invite members can read temporary voice notes"
  on public.guest_voice_notes
  for select
  to authenticated
  using (
    (select public.is_guest_invite_member(invite_id::text))
  );

drop policy if exists "Invite members can add their own temporary voice notes"
  on public.guest_voice_notes;
create policy "Invite members can add their own temporary voice notes"
  on public.guest_voice_notes
  for insert
  to authenticated
  with check (
    sender_id = (select auth.uid())
    and (select public.is_guest_invite_member(invite_id::text))
  );

drop policy if exists "Invite recipients can mark temporary notes listened"
  on public.guest_voice_notes;
create policy "Invite recipients can mark temporary notes listened"
  on public.guest_voice_notes
  for update
  to authenticated
  using (
    sender_id <> (select auth.uid())
    and (select public.is_guest_invite_member(invite_id::text))
  )
  with check (
    sender_id <> (select auth.uid())
    and (select public.is_guest_invite_member(invite_id::text))
  );

drop policy if exists "Invite senders can delete temporary notes"
  on public.guest_voice_notes;
create policy "Invite senders can delete temporary notes"
  on public.guest_voice_notes
  for delete
  to authenticated
  using (
    sender_id = (select auth.uid())
    and (select public.is_guest_invite_member(invite_id::text))
  );

-- Permanent signed-in users create an invite using a SHA-256 hash. The raw
-- 64-character token stays only in the share link.
create or replace function public.create_guest_invite(invite_hash text)
returns table (
  invite_id uuid,
  invite_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  created_id uuid;
  created_expires_at timestamptz;
begin
  if current_user_id is null then
    raise exception 'Sign in before creating a guest link.';
  end if;

  if coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) then
    raise exception 'Temporary guests cannot create another guest link.';
  end if;

  if invite_hash is null
    or char_length(invite_hash) <> 64
    or lower(invite_hash) !~ '^[0-9a-f]{64}$'
  then
    raise exception 'Invalid invitation token.';
  end if;

  insert into public.guest_invites (
    token_hash,
    creator_id,
    expires_at
  )
  values (
    lower(invite_hash),
    current_user_id,
    now() + interval '24 hours'
  )
  returning id, expires_at
  into created_id, created_expires_at;

  return query select created_id, created_expires_at;
end;
$$;

revoke all on function public.create_guest_invite(text)
  from public, anon;
grant execute on function public.create_guest_invite(text)
  to authenticated;

-- Verify a hash before creating an anonymous Auth user. A redeemed guest can
-- also reopen the link in the same browser session.
create or replace function public.guest_invite_available(invite_hash text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.guest_invites as invite
    where invite.token_hash = lower(invite_hash)
      and invite.expires_at > now()
      and (
        invite.guest_id is null
        or invite.guest_id = (select auth.uid())
      )
  );
$$;

revoke all on function public.guest_invite_available(text)
  from public;
grant execute on function public.guest_invite_available(text)
  to anon, authenticated;

-- Redeeming is one-person-only. Anonymous Auth supplies a stable auth.uid()
-- without asking the guest for an email address or password.
create or replace function public.redeem_guest_invite(invite_hash text)
returns table (
  invite_id uuid,
  invite_creator_id uuid,
  invite_guest_id uuid,
  invite_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target public.guest_invites%rowtype;
begin
  if current_user_id is null then
    raise exception 'Open the invitation again to continue.';
  end if;

  select invite.*
  into target
  from public.guest_invites as invite
  where invite.token_hash = lower(invite_hash)
    and invite.expires_at > now()
  limit 1
  for update;

  if target.id is null then
    raise exception 'This private link is invalid or has expired.';
  end if;

  if target.creator_id = current_user_id then
    raise exception 'Send this link to your guest instead of opening it yourself.';
  end if;

  if target.guest_id is not null and target.guest_id <> current_user_id then
    raise exception 'This private link has already been used.';
  end if;

  if target.guest_id is null then
    update public.guest_invites
    set guest_id = current_user_id
    where id = target.id;
    target.guest_id := current_user_id;
  end if;

  return query
    select
      target.id,
      target.creator_id,
      target.guest_id,
      target.expires_at;
end;
$$;

revoke all on function public.redeem_guest_invite(text)
  from public, anon;
grant execute on function public.redeem_guest_invite(text)
  to authenticated;

drop policy if exists "Invite members can hear temporary voice files"
  on storage.objects;
create policy "Invite members can hear temporary voice files"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'voice-notes'
    and (storage.foldername(name))[1] = 'guest'
    and (
      select public.is_guest_invite_member(
        (storage.foldername(name))[2]
      )
    )
  );

drop policy if exists "Invite members can upload temporary voice files"
  on storage.objects;
create policy "Invite members can upload temporary voice files"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'voice-notes'
    and (storage.foldername(name))[1] = 'guest'
    and (storage.foldername(name))[3] = (select auth.uid())::text
    and (
      select public.is_guest_invite_member(
        (storage.foldername(name))[2]
      )
    )
  );

drop policy if exists "Invite senders can delete temporary voice files"
  on storage.objects;
create policy "Invite senders can delete temporary voice files"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'voice-notes'
    and (storage.foldername(name))[1] = 'guest'
    and (storage.foldername(name))[3] = (select auth.uid())::text
    and (
      select public.is_guest_invite_member(
        (storage.foldername(name))[2]
      )
    )
  );

do $$
begin
  alter publication supabase_realtime
    add table public.guest_voice_notes;
exception
  when duplicate_object then null;
end;
$$;

commit;
