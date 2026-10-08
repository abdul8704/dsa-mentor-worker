-- ============================================================================
-- Opt-in public profiles (public read-only API)
-- ----------------------------------------------------------------------------
-- A user's dashboard data is private until they turn on a public profile in
-- Settings. Turning it on creates/updates one row here:
--
--   handle   — the public name used in API URLs
--              (GET /api/public/v1/users/<handle>/...). Never the Supabase
--              user id, so the API never leaks internal ids.
--   enabled  — master switch. When false (or no row exists) every public
--              endpoint for this user answers 404, exactly as if the handle
--              didn't exist.
--   widgets  — which dashboard widgets are exposed. Anything not listed
--              answers 404 even while the profile is enabled.
--
-- The public API itself (dsa-mentor/app/api/public/v1/) reads this table and
-- the analytics tables with the service-role client, and only after checking
-- `enabled` and `widgets` here. The owner manages their own row through the
-- session client, so RLS below only grants the owner access to their row.
-- ============================================================================

create table if not exists public.public_profiles (
    user_id    uuid primary key references auth.users(id) on delete cascade,
    handle     text not null unique
               check (handle ~ '^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$'),
    enabled    boolean not null default false,
    widgets    text[] not null default array[
                   'profile', 'streak', 'heatmap', 'stats',
                   'contest-rating', 'topics', 'recent-problems', 'contests'
               ]::text[]
               check (widgets <@ array[
                   'profile', 'streak', 'heatmap', 'stats',
                   'contest-rating', 'topics', 'recent-problems', 'contests'
               ]::text[]),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.public_profiles enable row level security;

drop policy if exists "public_profiles_owner_select" on public.public_profiles;
create policy "public_profiles_owner_select" on public.public_profiles
    for select to authenticated using (auth.uid() = user_id);

drop policy if exists "public_profiles_owner_insert" on public.public_profiles;
create policy "public_profiles_owner_insert" on public.public_profiles
    for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "public_profiles_owner_update" on public.public_profiles;
create policy "public_profiles_owner_update" on public.public_profiles
    for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "public_profiles_owner_delete" on public.public_profiles;
create policy "public_profiles_owner_delete" on public.public_profiles
    for delete to authenticated using (auth.uid() = user_id);

notify pgrst, 'reload schema';
