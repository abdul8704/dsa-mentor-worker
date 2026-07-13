import { getNewSolvedCountForDate, upsertDailyCount } from "../repository/dailyCount.repo.ts";
import { getAllUsers } from "../repository/profile.repo.ts";
import type { DailyCountUserResult, DailyCountAllResult } from "../types/response.ts";

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
 * Compute and upsert the daily new-problem count for a single user, for both
 * today and yesterday.
 *
 * Yesterday is re-checked on every run (not just today) because this job only
 * ever writes to the date that was "today" at the time it ran. If a user
 * solves something after the last run of a given day, that day's row would
 * otherwise be permanently stuck at a stale (too-low) count — which in turn
 * breaks the streak walk in `streak.ts` even though the user was actually
 * active that day. Re-checking yesterday on the next run gives every day one
 * more chance to be corrected to its final value before the streak logic
 * treats it as settled.
 */
export const updateDailyCountForUser = async (user_id: string): Promise<DailyCountUserResult> => {
    const today = getTodayUTC();
    const yesterday = addDays(today, -1);

    const [count, yesterdayCount] = await Promise.all([
        getNewSolvedCountForDate(user_id, today),
        getNewSolvedCountForDate(user_id, yesterday),
    ]);

    await Promise.all([
        upsertDailyCount(user_id, today, count),
        upsertDailyCount(user_id, yesterday, yesterdayCount),
    ]);

    console.log(`[DailyCount] ${user_id}: ${count} new problems on ${today} (yesterday ${yesterday}: ${yesterdayCount})`);
    return { success: true, user_id, date: today, solved: count };
};

/**
 * Compute and upsert daily counts for all users.
 */
export const updateDailyCountForAllUsers = async (): Promise<DailyCountAllResult> => {
    const users = await getAllUsers();
    let failed = 0;

    for (const user_id of users) {
        try {
            await updateDailyCountForUser(user_id);
        } catch (error) {
            failed++;
            if (error instanceof Error) {
                console.error(`[DailyCount] Failed for ${user_id}: ${error.message}`);
            } else {
                console.error(`[DailyCount] Failed for ${user_id}`);
            }
        }
    }

    return { success: failed === 0, processed: users.length, failed };
};
