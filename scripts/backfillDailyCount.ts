import { getAllUsers } from "../repository/profile.repo.ts";
import type { BackfillUserResult } from "../types/response.ts";
import { rebuildDailyCounts } from "../jobs/dailyCount.ts";

/**
 * Backfill script: rebuilds the daily_count table for each user from their
 * first activity to today, using the one shared definition of daily_count
 * (see jobs/dailyCount.ts → rebuildDailyCounts).
 *
 * Previously this walked day by day with one count query per day and only
 * counted first-ever solves — slow for multi-year histories, and a different
 * definition from the heatmap script, so the two overwrote each other.
 */
const backfillForUser = async (user_id: string): Promise<BackfillUserResult> => {
    const { days } = await rebuildDailyCounts(user_id);
    console.log(`[Backfill] ${user_id}: rebuilt ${days} days.`);
    return { success: true, user_id, daysProcessed: days };
};

// --- Main ---
export const backfillMain = async (user_id?: string) => {
    console.log("[Backfill] Starting daily_count backfill...");
    const users = user_id ? [user_id] : await getAllUsers();

    for (const user_id of users) {
        try {
            await backfillForUser(user_id);
        } catch (error) {
            if (error instanceof Error) {
                console.error(`[Backfill] Failed for ${user_id}: ${error.message}`);
            } else {
                console.error(`[Backfill] Failed for ${user_id}`);
            }
        }
    }

    console.log("[Backfill] All done.");
};
