import { getDailyCounts } from "../repository/dailyCount.repo.ts";
import { getUserStreak, upsertUserStreak } from "../repository/streak.repo.ts";
import { getAllUsers } from "../repository/profile.repo.ts";
import type { StreakUserResult, StreakAllResult } from "../types/response.ts";

/**
 * Get today's date in UTC as YYYY-MM-DD.
 */
const getTodayUTC = (): string => new Date().toISOString().split("T")[0]!;

/**
 * Add N days to a YYYY-MM-DD date string and return as YYYY-MM-DD.
 */
const addDays = (dateStr: string, days: number): string => {
    const date = new Date(dateStr + "T00:00:00Z");
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().split("T")[0]!;
};

/**
 * Compute and update the streak for a single user.
 *
 * `curr_streak`/`updated_on` always represent the streak **confirmed through
 * yesterday** — never including today. Today's day isn't over yet, so its
 * daily_count entry can still change (the user might solve more later), and
 * baking a "today" bonus into the persisted value made the result depend on
 * *when* during the day this job happened to run — e.g. if it ran once early
 * (before the user solved anything) it would lock in `updated_on = today`
 * and every later run that same day would skip re-checking today entirely,
 * even after daily_count[today] became non-zero. By only ever confirming
 * through yesterday, this job is idempotent no matter how many times it runs
 * per day, and callers that want to show "today included" combine this with
 * a live solved-today check (see `getStreakData` on the frontend).
 *
 * Algorithm:
 * 1. Fetch existing streak row (or treat as fresh if none).
 * 2. Determine the scan window: from (updated_on + 1) to yesterday.
 *    - If no updated_on (first time), scan all daily_count history.
 *    - If already confirmed through yesterday (or later), nothing to do.
 * 3. Walk day-by-day through the window:
 *    - solved > 0 → extend streak
 *    - solved = 0 → update longest_streak = max(longest, curr), then reset curr to 0
 * 4. Final longest_streak = max(longest, curr).
 * 5. Upsert to user-streak with updated_on = yesterday.
 */
export const updateStreakForUser = async (user_id: string): Promise<StreakUserResult> => {
    const today = getTodayUTC();
    const yesterday = addDays(today, -1);

    // Fetch existing streak data
    const existingStreak = await getUserStreak(user_id);

    let currStreak = existingStreak?.curr_streak ?? 0;
    let longestStreak = existingStreak?.longest_streak ?? 0;
    const updatedOn = existingStreak?.updated_on ?? null;

    // Determine scan start date
    let scanStart: string;

    if (!updatedOn) {
        // First time: scan all history. We'll fetch everything up to yesterday
        // and find the latest unbroken chain ending at yesterday.
        // Use a far-back date to get full history.
        scanStart = "2000-01-01";
        currStreak = 0; // Recompute from scratch
    } else if (updatedOn >= yesterday) {
        // Already confirmed through yesterday (or later), nothing new to walk.
        console.log(`[Streak] ${user_id}: already confirmed through ${updatedOn}`);
        return { success: true, user_id, curr_streak: currStreak, longest_streak: longestStreak };
    } else {
        // Start from the day after last update
        scanStart = addDays(updatedOn, 1);
    }

    // Fetch daily counts from scanStart through yesterday — today is
    // intentionally excluded, see rationale above.
    const dailyCounts = await getDailyCounts(user_id, scanStart, yesterday);

    // Build a map for quick lookup: date -> solved count
    const countMap = new Map<string, number>();
    for (const entry of dailyCounts) {
        countMap.set(entry.date, entry.solved);
    }

    // Walk day-by-day from scanStart to yesterday
    let currentDate = scanStart;

    while (currentDate <= yesterday) {
        const solved = countMap.get(currentDate) ?? 0;

        if (solved > 0) {
            currStreak++;
        } else {
            // Update longest before resetting
            longestStreak = Math.max(longestStreak, currStreak);
            currStreak = 0;
        }

        currentDate = addDays(currentDate, 1);
    }

    // Final longest check
    longestStreak = Math.max(longestStreak, currStreak);

    // Upsert — confirmed through yesterday
    await upsertUserStreak(user_id, currStreak, longestStreak, yesterday);

    console.log(
        `[Streak] ${user_id}: curr=${currStreak}, longest=${longestStreak}, confirmed through=${yesterday}`
    );

    return { success: true, user_id, curr_streak: currStreak, longest_streak: longestStreak };
};

/**
 * Compute and update streaks for all users.
 */
export const updateStreakForAllUsers = async (): Promise<StreakAllResult> => {
    const users = await getAllUsers();
    let failed = 0;

    for (const user_id of users) {
        try {
            await updateStreakForUser(user_id);
        } catch (error) {
            failed++;
            if (error instanceof Error) {
                console.error(`[Streak] Failed for ${user_id}: ${error.message}`);
            } else {
                console.error(`[Streak] Failed for ${user_id}`);
            }
        }
    }

    return { success: failed === 0, processed: users.length, failed };
};
