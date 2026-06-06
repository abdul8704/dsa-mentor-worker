# DSA Mentor Worker

A lightweight worker service to help mentors guide their mentees by better tracking competitive programming activity across platforms.

## Focus
- Help mentors monitor mentees' problem-solving activity, streaks, and contest participation.
- Aggregate and normalize platform data so mentors can focus on guidance and progress (not data collection).

## Key Features
- Periodic jobs to refresh contest and user data (contest refresh, daily counts, streaks).
- Multi-platform clients: AtCoder, Codeforces, and LeetCode integrations to fetch and normalize activity.
- Repositories and services layer for storing/updating tracked data in Supabase.
- Routes and utilities for producing user heatmaps and other mentor-facing views.
- Scripts for backfilling historical data and maintenance tasks.

## High-level overview
- Entry point: `index.ts` — boots the worker and background jobs.
- `services/` — business logic and platform client orchestration.
- `jobs/` — scheduled tasks that compute daily counts, refresh contests, update streaks, and record problem solves.
- `repository/` — data access layer that persists and queries data from Supabase.
- `routes/` — lightweight HTTP endpoints (e.g. user heatmap) used for lightweight reads or debugging.
- `scripts/` — one-off helpers like backfills and maintenance scripts.
- `types/` and `supabase/` — shared types and supabase-related helpers.

## Tech stack
- Node.js + TypeScript
- Supabase (Postgres + Auth) for persistence
- Express for lightweight routes
- Axios + Cheerio for scraping/platform clients
- Development helpers: `ts-node`, `ts-node-dev`, `typescript`

## Local setup
Prerequisites:
- Node.js (v16+ recommended)
- A Supabase project (URL + service or anon key)

Quick start:

1. Install dependencies

```bash
npm install
```

2. Provide environment variables

- Create a `.env` file (or set env vars) with at least the Supabase values used by the app, for example:

```
SUPABASE_URL=your-supabase-url
SUPABASE_KEY=your-supabase-key
```

3. Run in development

```bash
npx ts-node-dev --respawn --transpile-only index.ts
```

4. Build and run (production)

```bash
npm run build # tsc
node index.js
```

Notes:
- There are no predefined `start`/`dev` scripts in `package.json`; use the `ts-node-dev` command above for local development or add scripts as you prefer.
- Check `config/env.ts` for additional configuration keys the project expects.

## Project structure (high level)
- `index.ts` — application entry
- `services/` — platform clients and business logic
- `jobs/` — background jobs run on schedule
- `repository/` — Supabase access and domain repositories
- `routes/` — small HTTP endpoints (heatmap, status)
- `scripts/` — backfills and helpers
- `types/` — shared TypeScript types

## Contributing
- Open an issue or PR with a clear description of the change.
- Keep changes focused: update jobs, services, or repositories in isolation when possible.

If you want, I can add `npm` scripts for common workflows (`dev`, `build`, `start`) and a `.env.example` file — tell me which you'd prefer.
