-- ============================================================================
-- Mentorship domain schema
-- ----------------------------------------------------------------------------
-- Adds the mentor <-> mentee relationship layer on top of the existing
-- single-user analytics tables. Everything is keyed by the Supabase Auth user
-- id (auth.users.id), consistent with the rest of the schema.
--
-- Tables:
--   mentorships  - active relationships between a mentor and a mentee
--   invites      - pending/accepted invitations (by email or existing user)
--   assignments  - problems a mentor assigns to a mentee, with completion state
--
-- RLS: enabled on all three tables. The Supabase service-role key (used by the
-- worker and by verified mentor read paths) bypasses RLS. The policies below
-- constrain what a normal authenticated session (anon key + JWT) may do.
-- ============================================================================

create extension if not exists citext;

-- ----------------------------------------------------------------------------
-- 1. mentorships
-- ----------------------------------------------------------------------------
create table if not exists public.mentorships (
    id         uuid primary key default gen_random_uuid(),
    mentor_id  uuid not null references auth.users(id) on delete cascade,
    mentee_id  uuid not null references auth.users(id) on delete cascade,
    status     text not null default 'active' check (status in ('active','paused','ended')),
    created_at timestamptz not null default now(),
    unique (mentor_id, mentee_id),
    check (mentor_id <> mentee_id)
);

create index if not exists mentorships_mentor_idx on public.mentorships(mentor_id);
create index if not exists mentorships_mentee_idx on public.mentorships(mentee_id);

-- ----------------------------------------------------------------------------
-- 2. invites
-- ----------------------------------------------------------------------------
create table if not exists public.invites (
    id              uuid primary key default gen_random_uuid(),
    mentor_id       uuid not null references auth.users(id) on delete cascade,
    invitee_email   citext not null,
    invitee_user_id uuid references auth.users(id) on delete set null,
    token           uuid not null default gen_random_uuid() unique,
    status          text not null default 'pending' check (status in ('pending','accepted','declined','expired')),
    created_at      timestamptz not null default now(),
    expires_at      timestamptz not null default (now() + interval '14 days'),
    responded_at    timestamptz
);

create index if not exists invites_mentor_idx on public.invites(mentor_id);
create index if not exists invites_email_idx  on public.invites(invitee_email);

-- ----------------------------------------------------------------------------
-- 3. assignments
-- ----------------------------------------------------------------------------
create table if not exists public.assignments (
    id            uuid primary key default gen_random_uuid(),
    mentor_id     uuid not null references auth.users(id) on delete cascade,
    mentee_id     uuid not null references auth.users(id) on delete cascade,
    platform      text not null,
    problem_id    text not null references public.problems(problem_id),
    title         text not null,
    url           text,
    note          text,
    due_date      date,
    status        text not null default 'pending' check (status in ('pending','completed')),
    assigned_at   timestamptz not null default now(),
    completed_at  timestamptz,
    completed_via text check (completed_via in ('auto','manual'))
);

create index if not exists assignments_mentee_idx  on public.assignments(mentee_id);
create index if not exists assignments_mentor_idx  on public.assignments(mentor_id);
create index if not exists assignments_status_idx  on public.assignments(status);

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------
alter table public.mentorships enable row level security;
alter table public.invites     enable row level security;
alter table public.assignments enable row level security;

-- mentorships: both parties can read; mentee creates on accept; both can update/delete
drop policy if exists mentorships_select on public.mentorships;
create policy mentorships_select on public.mentorships
    for select using (auth.uid() in (mentor_id, mentee_id));

drop policy if exists mentorships_insert on public.mentorships;
create policy mentorships_insert on public.mentorships
    for insert with check (auth.uid() = mentee_id);

drop policy if exists mentorships_update on public.mentorships;
create policy mentorships_update on public.mentorships
    for update using (auth.uid() in (mentor_id, mentee_id));

drop policy if exists mentorships_delete on public.mentorships;
create policy mentorships_delete on public.mentorships
    for delete using (auth.uid() in (mentor_id, mentee_id));

-- invites: mentor manages own; invitee (by user id or email) can read/respond
drop policy if exists invites_select on public.invites;
create policy invites_select on public.invites
    for select using (
        auth.uid() = mentor_id
        or auth.uid() = invitee_user_id
        or invitee_email = (auth.jwt() ->> 'email')
    );

drop policy if exists invites_insert on public.invites;
create policy invites_insert on public.invites
    for insert with check (auth.uid() = mentor_id);

drop policy if exists invites_update on public.invites;
create policy invites_update on public.invites
    for update using (
        auth.uid() = mentor_id
        or auth.uid() = invitee_user_id
        or invitee_email = (auth.jwt() ->> 'email')
    );

-- assignments: mentor manages own; mentee can read and update (manual complete)
drop policy if exists assignments_select on public.assignments;
create policy assignments_select on public.assignments
    for select using (auth.uid() in (mentor_id, mentee_id));

drop policy if exists assignments_insert on public.assignments;
create policy assignments_insert on public.assignments
    for insert with check (auth.uid() = mentor_id);

drop policy if exists assignments_update on public.assignments;
create policy assignments_update on public.assignments
    for update using (auth.uid() in (mentor_id, mentee_id));

drop policy if exists assignments_delete on public.assignments;
create policy assignments_delete on public.assignments
    for delete using (auth.uid() = mentor_id);
