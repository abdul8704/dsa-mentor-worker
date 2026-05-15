/**
 * Standardized response types for all service and repository functions.
 * Replaces Promise<void> with meaningful return types for better debugging.
 */

// ─── Generic ────────────────────────────────────────────────────────

export type OperationResult = {
    success: boolean;
    message?: string;
};

// ─── Repository: solved_problems ────────────────────────────────────

export type AddSolvedProblemsResult = {
    success: boolean;
    insertedCount: number;
};

// ─── Repository: problems ───────────────────────────────────────────

export type AddProblemsResult = {
    success: boolean;
    count: number;
};

// ─── Repository: user_platform_data ─────────────────────────────────

export type UpsertPlatformDataResult = {
    success: boolean;
    user_id: string;
    platform: string;
};

// ─── Repository: daily_count ────────────────────────────────────────

export type UpsertDailyCountResult = {
    success: boolean;
    user_id: string;
    date: string;
    solved: number;
};

// ─── Repository: user-streak ────────────────────────────────────────

export type UpsertStreakResult = {
    success: boolean;
    user_id: string;
    curr_streak: number;
    longest_streak: number;
    updated_on: string;
};

// ─── Jobs: dailyCount ───────────────────────────────────────────────

export type DailyCountUserResult = {
    success: boolean;
    user_id: string;
    date: string;
    solved: number;
};

export type DailyCountAllResult = {
    success: boolean;
    processed: number;
    failed: number;
};

// ─── Jobs: streak ───────────────────────────────────────────────────

export type StreakUserResult = {
    success: boolean;
    user_id: string;
    curr_streak: number;
    longest_streak: number;
};

export type StreakAllResult = {
    success: boolean;
    processed: number;
    failed: number;
};

// ─── Jobs: problemSolved (refresh) ──────────────────────────────────

export type RefreshAllResult = {
    success: boolean;
};

// ─── Services: platform sync ────────────────────────────────────────

export type PlatformSyncResult = {
    success: boolean;
    user_id: string;
    platform: string;
    newSubmissions: number;
};

// ─── Scripts: backfill ──────────────────────────────────────────────

export type BackfillUserResult = {
    success: boolean;
    user_id: string;
    daysProcessed: number;
};

export type BackfillAllResult = {
    success: boolean;
    processed: number;
    failed: number;
};

// ─── Repository: user_contest ─────────────────────────────────────────

export type UpsertUserContestsResult = {
    success: boolean;
    upsertedCount: number;
};

// ─── Services: contest sync ───────────────────────────────────────────

export type ContestSyncResult = {
    success: boolean;
    user_id: string;
    platform: string;
    contestsSynced: number;
};

// ─── Jobs: contestRefresh ─────────────────────────────────────────────

export type ContestRefreshAllResult = {
    success: boolean;
    processed: number;
    failed: number;
};
