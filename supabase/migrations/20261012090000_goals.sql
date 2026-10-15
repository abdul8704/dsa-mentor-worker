-- ============================================================================
-- Goals (dashboard "Goals" page)
-- ----------------------------------------------------------------------------
-- Two kinds of goal, both owned by `user_id` (the person working towards it):
--
--   solve  — "solve `target_count` problems on `platforms` between
--            start_date and end_date". With include_already_solved = false
--            only first-ever solves count; with true, re-solves count too.
--            Can repeat weekly/monthly: each period starts at start_date +
--            k weeks/months and progress resets; end_date is then an optional
--            "repeat until" (null = forever).
--   revise — "re-solve these specific problems (goal_problems) between
--            start_date and end_date". One-off only.
--
-- Progress is never stored: dsa-mentor computes it from solved_problems on
-- read (app/actions/goals.actions.ts), so it can't drift from synced data.
-- The only stored progress-ish field is goal_problems.manually_revised_at,
-- the "mark as revised" fallback for revisions done without resubmitting.
--
-- Access: the owner, or anyone who actively mentors the owner (mentors can
-- create and manage goals for their mentees). created_by records who set it.
-- ============================================================================

create table if not exists public.goals (
    id                     uuid primary key default gen_random_uuid(),
    user_id                uuid not null references auth.users(id) on delete cascade,
    created_by             uuid not null references auth.users(id) on delete cascade,
    name                   text not null check (char_length(name) between 1 and 120),
    kind                   text not null check (kind in ('solve', 'revise')),
    start_date             date not null,
    end_date               date,
    recurrence             text not null default 'none' check (recurrence in ('none', 'weekly', 'monthly')),
    target_count           integer check (target_count is null or target_count between 1 and 10000),
    -- null = every platform
    platforms              text[],
    include_already_solved boolean not null default false,
    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now(),

    check (end_date is null or end_date >= start_date),
    -- a one-off goal needs a due date; only repeating goals may run forever
    check (recurrence <> 'none' or end_date is not null),
    check (kind <> 'solve' or target_count is not null),
    check (kind <> 'revise' or recurrence = 'none')
);

create index if not exists goals_user_idx on public.goals(user_id);

create table if not exists public.goal_problems (
    goal_id             uuid not null references public.goals(id) on delete cascade,
    problem_id          text not null references public.problems(problem_id),
    manually_revised_at timestamptz,
    primary key (goal_id, problem_id)
);

create index if not exists goal_problems_problem_idx on public.goal_problems(problem_id);

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------
alter table public.goals         enable row level security;
alter table public.goal_problems enable row level security;

-- True when the current user owns `owner` or actively mentors them.
create or replace function public.can_manage_goals_of(owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select auth.uid() = owner
        or exists (
            select 1 from public.mentorships m
            where m.mentor_id = auth.uid()
              and m.mentee_id = owner
              and m.status = 'active'
        );
$$;

drop policy if exists goals_select on public.goals;
create policy goals_select on public.goals
    for select to authenticated using (public.can_manage_goals_of(user_id));

drop policy if exists goals_insert on public.goals;
create policy goals_insert on public.goals
    for insert to authenticated
    with check (created_by = auth.uid() and public.can_manage_goals_of(user_id));

drop policy if exists goals_update on public.goals;
create policy goals_update on public.goals
    for update to authenticated
    using (public.can_manage_goals_of(user_id))
    with check (public.can_manage_goals_of(user_id));

drop policy if exists goals_delete on public.goals;
create policy goals_delete on public.goals
    for delete to authenticated using (public.can_manage_goals_of(user_id));

drop policy if exists goal_problems_all on public.goal_problems;
create policy goal_problems_all on public.goal_problems
    for all to authenticated
    using (exists (
        select 1 from public.goals g
        where g.id = goal_id and public.can_manage_goals_of(g.user_id)
    ))
    with check (exists (
        select 1 from public.goals g
        where g.id = goal_id and public.can_manage_goals_of(g.user_id)
    ));

notify pgrst, 'reload schema';
