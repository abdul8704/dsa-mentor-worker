import { getNewSolvedCountForDate, upsertDailyCount } from "../repository/dailyCount.repo.ts";
import { getAllUsers } from "../repository/profile.repo.ts";

/**
 * Get today's date in UTC as YYYY-MM-DD.
 */
const getTodayUTC = (): string => new Date().toISOString().split("T")[0]!;

/**
 * Compute and upsert the daily new-problem count for a single user for today.
 */
export const updateDailyCountForUser = async (user_id: string): Promise<void> => {
    const today = getTodayUTC();
    const count = await getNewSolvedCountForDate(user_id, today);
    await upsertDailyCount(user_id, today, count);
    console.log(`[DailyCount] ${user_id}: ${count} new problems on ${today}`);
};

/**
 * Compute and upsert daily counts for all users.
 */
export const updateDailyCountForAllUsers = async (): Promise<void> => {
    const users = await getAllUsers();

    for (const user_id of users) {
        try {
            await updateDailyCountForUser(user_id);
        } catch (error) {
            if (error instanceof Error) {
                console.error(`[DailyCount] Failed for ${user_id}: ${error.message}`);
            } else {
                console.error(`[DailyCount] Failed for ${user_id}`);
            }
        }
    }
};
