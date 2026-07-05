import { deleteSolvedProblemsForPlatform } from "../repository/solvedProblems.repo.ts";
import { deleteUserContestsForPlatform } from "../repository/userContest.repo.ts";
import { deleteUserPlatformData } from "../repository/userPlatformData.repo.ts";
import { deleteDailyCountsForUser } from "../repository/dailyCount.repo.ts";
import { deleteUserStreak } from "../repository/streak.repo.ts";
import { updateLastRefreshed } from "../repository/profile.repo.ts";
import { setupUser } from "./problemSolved.ts";
import { refreshUserContests } from "./contestRefresh.ts";
import { updateStreakForUser } from "./streak.ts";
import { platformMain } from "../scripts/refreshPlatformData.ts";
import { heatMapMain } from "../scripts/refreshHeatmap.ts";
import { backfillMain } from "../scripts/backfillDailyCount.ts";

/**
 * Remove every piece of platform-scoped data for a user on a single platform.
 *
 * A solved problem / contest / aggregate row is only ever keyed by
 * (user_id, platform) — never by handle — so once a handle changes there is no
 * way to know which existing rows belonged to the old handle. The only correct
 * option is to wipe the platform's data and re-import it from the new handle.
 */
export const purgePlatformData = async (user_id: string, platform: string): Promise<void> => {
    await deleteSolvedProblemsForPlatform(user_id, platform);
    await deleteUserContestsForPlatform(user_id, platform);
    await deleteUserPlatformData(user_id, platform);
    console.log(`[HandleChange] Purged data for user=${user_id} platform=${platform}`);
};

/**
 * Re-establish a consistent state after one or more platform handles change.
 *
 * Steps:
 *   1. Purge platform-scoped data (solved_problems, user_contest,
 *      user_platform_data) for every affected platform.
 *   2. Delete the cross-platform aggregates (daily_count) that were derived
 *      from the now-removed rows so they can be rebuilt cleanly.
 *   3. Re-import full history for the affected platforms from the new handles.
 *   4. Rebuild the derived aggregates (difficulty counts, heatmap, daily_count).
 *   5. Recompute the streak from scratch (delete then rebuild) so a stale row
 *      left by the heatmap step can't short-circuit the recompute.
 *
 * The whole thing is idempotent: purging a platform that had no rows is a
 * no-op, so brand-new platforms added during an edit are handled correctly too.
 */
export const resyncAfterHandleChange = async (
    user_id: string,
    platforms: string[]
): Promise<void> => {
    if (!platforms.length) {
        console.log(`[HandleChange] No affected platforms for user=${user_id}, skipping.`);
        return;
    }

    console.log(`[HandleChange] Resyncing user=${user_id} platforms=${platforms.join(", ")}`);

    // 1. Purge each affected platform.
    for (const platform of platforms) {
        await purgePlatformData(user_id, platform);
    }

    // 2. Drop the cross-platform daily_count aggregate (rebuilt below).
    await deleteDailyCountsForUser(user_id);

    // 3. Re-import full history for the affected platforms only.
    await setupUser(user_id, platforms);

    // 4. Rebuild derived aggregates from the refreshed solved_problems.
    await platformMain(user_id);
    await backfillMain(user_id);
    await heatMapMain(user_id);
    await refreshUserContests(user_id);

    // 5. Recompute the streak from scratch. Deleting after heatMapMain ensures
    //    the row heatMapMain may have written (with updated_on = today) can't
    //    make updateStreakForUser think it already ran today.
    await deleteUserStreak(user_id);
    await updateStreakForUser(user_id);

    await updateLastRefreshed(user_id);

    console.log(`[HandleChange] Resync complete for user=${user_id}`);
};
