-- ============================================================================
-- Mentee groups + mentor notes schema
-- ----------------------------------------------------------------------------
-- Adds two features on top of the mentorship domain:
--   mentee_groups        - a mentor-defined grouping of their mentees, used to
--                           assign tasks / send notes to many mentees at once.
--   mentee_group_members  - membership rows (many-to-many, mentor-owned).
--   mentor_notes          - free-text notes a mentor sends to a mentee.
--
-- Groups are intentionally mentor-only: there is no RLS path that lets a
-- mentee read `mentee_groups` or `mentee_group_members`, so mentees can never
-- discover they were placed in a group. Notes ARE readable by the mentee they
-- were sent to (that's the point), but the note row never reveals whether it
-- was sent 1:1 or fanned out from a group action.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. mentee_groups
-- ----------------------------------------------------------------------------
create table if not exists public.mentee_groups (
    id         uuid primary key default gen_random_uuid(),
    mentor_id  uuid not null references auth.users(id) on delete cascade,
    name       text not null check (char_length(trim(name)) > 0),
    created_at timestamptz not null default now(),
    unique (mentor_id, name)
);

create index if not exists mentee_groups_mentor_idx on public.mentee_groups(mentor_id);

-- ----------------------------------------------------------------------------
-- 2. mentee_group_members
-- ----------------------------------------------------------------------------
create table if not exists public.mentee_group_members (
    group_id   uuid not null references public.mentee_groups(id) on delete cascade,
    mentee_id  uuid not null references auth.users(id) on delete cascade,
    added_at   timestamptz not null default now(),
    primary key (group_id, mentee_id)
);

create index if not exists mentee_group_members_mentee_idx on public.mentee_group_members(mentee_id);

-- ----------------------------------------------------------------------------
-- 3. mentor_notes
-- ----------------------------------------------------------------------------
create table if not exists public.mentor_notes (
    id         uuid primary key default gen_random_uuid(),
    mentor_id  uuid not null references auth.users(id) on delete cascade,
    mentee_id  uuid not null references auth.users(id) on delete cascade,
    body       text not null check (char_length(trim(body)) > 0),
    created_at timestamptz not null default now()
);

create index if not exists mentor_notes_mentee_idx on public.mentor_notes(mentee_id);
create index if not exists mentor_notes_mentor_idx on public.mentor_notes(mentor_id);

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------
alter table public.mentee_groups        enable row level security;
alter table public.mentee_group_members enable row level security;
alter table public.mentor_notes         enable row level security;

-- mentee_groups: mentor-only, full CRUD on their own groups. No mentee access.
drop policy if exists mentee_groups_select on public.mentee_groups;
create policy mentee_groups_select on public.mentee_groups
    for select using (auth.uid() = mentor_id);

drop policy if exists mentee_groups_insert on public.mentee_groups;
create policy mentee_groups_insert on public.mentee_groups
    for insert with check (auth.uid() = mentor_id);

drop policy if exists mentee_groups_update on public.mentee_groups;
create policy mentee_groups_update on public.mentee_groups
    for update using (auth.uid() = mentor_id);

drop policy if exists mentee_groups_delete on public.mentee_groups;
create policy mentee_groups_delete on public.mentee_groups
    for delete using (auth.uid() = mentor_id);

-- mentee_group_members: mentor-only, scoped via the owning group. No mentee access.
drop policy if exists mentee_group_members_select on public.mentee_group_members;
create policy mentee_group_members_select on public.mentee_group_members
    for select using (
        exists (
            select 1 from public.mentee_groups g
            where g.id = group_id and g.mentor_id = auth.uid()
        )
    );

drop policy if exists mentee_group_members_insert on public.mentee_group_members;
create policy mentee_group_members_insert on public.mentee_group_members
    for insert with check (
        exists (
            select 1 from public.mentee_groups g
            where g.id = group_id and g.mentor_id = auth.uid()
        )
    );

drop policy if exists mentee_group_members_delete on public.mentee_group_members;
create policy mentee_group_members_delete on public.mentee_group_members
    for delete using (
        exists (
            select 1 from public.mentee_groups g
            where g.id = group_id and g.mentor_id = auth.uid()
        )
    );

-- mentor_notes: mentor writes; both mentor and the addressed mentee can read.
drop policy if exists mentor_notes_select on public.mentor_notes;
create policy mentor_notes_select on public.mentor_notes
    for select using (auth.uid() in (mentor_id, mentee_id));

drop policy if exists mentor_notes_insert on public.mentor_notes;
create policy mentor_notes_insert on public.mentor_notes
    for insert with check (auth.uid() = mentor_id);

drop policy if exists mentor_notes_delete on public.mentor_notes;
create policy mentor_notes_delete on public.mentor_notes
    for delete using (auth.uid() = mentor_id);
