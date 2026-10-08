-- Copied from db/solved_problems_unique.sql
-- ============================================================================
-- solved_problems: at most one row per (user, problem, day)
-- ----------------------------------------------------------------------------
-- The worker already dedupes in code before inserting (filterNewSolved* +
-- repository/solvedProblems.repo.ts). This index is the database-level
-- guarantee, so concurrent writers (the 3-hour cron and a LeetCode history
-- import running for the same user at once) can never produce duplicates.
-- Once it exists, addSolvedProblems' upsert(..., ignoreDuplicates) uses it
-- automatically; before it exists, that code falls back to a plain insert.
--
-- Run once in the Supabase SQL editor. Step 1 removes any duplicates that
-- already exist (keeping one row per user/problem/day, preferring the one
-- flagged as the first solve), otherwise step 2 would fail.
-- ============================================================================


-- 1. Remove existing duplicates.
delete from public.solved_problems sp
using (
    select ctid,
           row_number() over (
               partition by user_id, problem_id, solved_date
               order by already_solved asc, solved_at asc
           ) as rn
    from public.solved_problems
) d
where sp.ctid = d.ctid
  and d.rn > 1;

-- 2. Enforce uniqueness going forward.
create unique index if not exists solved_problems_user_problem_date_uidx
    on public.solved_problems (user_id, problem_id, solved_date);

