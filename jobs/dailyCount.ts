import { getNewSolvedCountForDate, upsertDailyCount } from "../repository/dailyCount.repo.ts";
import { getAllUsers } from "../repository/profile.repo.ts";
import type { DailyCountUserResult, DailyCountAllResult } from "../types/response.ts";

/**
 * Get today's date in UTC as YYYY-MM-DD.
 */
const getTodayUTC = (): string => new Date().toISOString().split("T")[0]!;

/**
 * Compute and upsert the daily new-problem count for a single user for today.
 */
export const updateDailyCountForUser = async (user_id: string): Promise<DailyCountUserResult> => {
    const today = getTodayUTC();
    const count = await getNewSolvedCountForDate(user_id, today);
    await upsertDailyCount(user_id, today, count);
    console.log(`[DailyCount] ${user_id}: ${count} new problems on ${today}`);
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
