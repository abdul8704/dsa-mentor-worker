-- ============================================================================
-- CSES credential storage
-- ----------------------------------------------------------------------------
-- Unlike Codeforces/AtCoder/LeetCode (public, unauthenticated APIs keyed by a
-- handle), CSES has no public API: reading a mentee's solved-problem status
-- requires a live logged-in session for their own CSES account. This table
-- holds the encrypted credential the worker uses to act as that session.
--
-- The value is encrypted at the APPLICATION layer (see utils/crypto.ts),
-- never in plaintext and never via a SQL-level function — `encrypted_value`
-- is opaque ciphertext as far as Postgres is concerned. The service-role key
-- (used by the worker) is the only thing that can read or write this table;
-- there is no anon/authenticated-role policy, on purpose — no client-side
-- code should ever need to touch it directly, only the worker's own
-- POST /cses/connect route and its background sync jobs.
--
-- kind: currently only 'cookie' (a PHPSESSID value) is supported — see
-- CSES_INTEGRATION_PLAN.md §3.3 for why password storage was deliberately
-- deferred.
-- status:
--   active       — last verified login and has been working.
--   needs_reauth — a sync detected the session no longer logs in (CSES
--                  returned its logged-out page); the mentee must re-paste
--                  a fresh cookie. Surface this in the dashboard distinctly
--                  from "handle invalid".
--   expired      — reserved for a future explicit-expiry check; unused for
--                  now since CSES doesn't advertise a cookie TTL.
-- ============================================================================

create table if not exists public.user_platform_secrets (
    user_id          uuid not null references auth.users(id) on delete cascade,
    platform         text not null,
    kind             text not null default 'cookie' check (kind in ('cookie', 'password')),
    encrypted_value  text not null,
    status           text not null default 'active' check (status in ('active', 'needs_reauth', 'expired')),
    last_verified_at timestamptz,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    primary key (user_id, platform)
);

create index if not exists user_platform_secrets_status_idx on public.user_platform_secrets(status);

alter table public.user_platform_secrets enable row level security;

-- Deliberately no select/insert/update policy for the anon/authenticated
-- roles: this table is written and read exclusively by the worker's
-- service-role client, which bypasses RLS. A mentee never has a reason to
-- read their own encrypted secret, and no UI should be built that lets them.

-- Reminder for whoever runs this migration: after applying it, regenerate
-- types/db.ts (`supabase gen types typescript ...`) — a hand-written
-- `user_platform_secrets` entry was added to both dsa-mentor-worker's and
-- (if needed) dsa-mentor's copy of that file to keep the worker compiling
-- until this migration is actually applied and types are regenerated for
-- real; the hand-written version should match exactly, but the generator
-- is the source of truth going forward.

notify pgrst, 'reload schema';
