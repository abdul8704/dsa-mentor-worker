import { getAllUsers } from "../repository/profile.repo.ts";
import { rebuildDailyCounts } from "../jobs/dailyCount.ts";
import { getUserStreak, upsertUserStreak } from "../repository/streak.repo.ts";

/**
 * Rebuilds the daily_count (heatmap) table for a user from solved_problems
 * across ALL platforms (LeetCode, Codeforces, AtCoder, CSES), via the shared
 * definition in jobs/dailyCount.ts → rebuildDailyCounts.
 *
 * Also keeps longest_streak at least as high as LeetCode's own reported
 * streak, for users whose LeetCode history comes from the public calendar
 * (no stored session keys).
 *
 * Run: bun run scripts/refreshHeatmap.ts
 */
const refreshHeatmapForUser = async (user_id: string): Promise<number> => {
    const { days, lcStreak } = await rebuildDailyCounts(user_id);

    // `user-streak.updated_on` means "confirmed through this date" (see
    // jobs/streak.ts) and never includes today — mirror that here so a
    // brand-new streak row created by this script doesn't get skipped by a
    // later streak.ts run that thinks today is already confirmed.
    const yesterdayDate = new Date();
    yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
    const yesterday = yesterdayDate.toISOString().split("T")[0]!;

    if (lcStreak > 0) {
        const existingStreak = await getUserStreak(user_id);
        const dbLongest = existingStreak?.longest_streak ?? 0;
        const dbCurrent = existingStreak?.curr_streak ?? 0;
        const newLongest = Math.max(lcStreak, dbLongest);

        if (newLongest !== dbLongest) {
            await upsertUserStreak(user_id, dbCurrent, newLongest, existingStreak?.updated_on ?? yesterday);
            console.log(`  [streak] longest_streak updated: ${dbLongest} → ${newLongest} (LC API streak=${lcStreak})`);
        }
    }

    return days;
};

// --- Main ---
export const heatMapMain = async (user_id?: string) => {
    console.log("[RefreshHeatmap] Starting...");
    const users = user_id ? [user_id] : await getAllUsers();
    console.log(`[RefreshHeatmap] Found ${users.length} users.`);

    let processed = 0;
    let failed = 0;

    for (const user_id of users) {
        try {
            console.log(`[RefreshHeatmap] Processing user ${user_id}...`);
            const daysUpdated = await refreshHeatmapForUser(user_id);
            console.log(`[RefreshHeatmap] ${user_id}: ${daysUpdated} days upserted.`);
            processed++;
        } catch (error) {
            failed++;
            if (error instanceof Error) {
                console.error(`[RefreshHeatmap] Failed for ${user_id}: ${error.message}`);
            } else {
                console.error(`[RefreshHeatmap] Failed for ${user_id}`);
            }
        }
    }

    console.log(`[RefreshHeatmap] Done. processed=${processed} failed=${failed}`);
};

