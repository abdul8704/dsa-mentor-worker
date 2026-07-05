-- ============================================================================
-- Profile avatar column
-- ----------------------------------------------------------------------------
-- Adds a nullable `avatar_url` column to `profile`, storing the public S3 URL
-- of the user's uploaded profile picture. Uploads are handled server-side
-- (Next.js server action) using the AWS SDK; only the resulting URL is
-- persisted here. Existing RLS policies on `profile` already scope
-- reads/writes to the owning user, so no new policies are required.
-- ============================================================================

alter table public.profile add column if not exists avatar_url text;
