import { supabase } from "../db/supabase.ts";
import { getAllUsers } from "../repository/profile.repo.ts";
import { getUserPlatforms } from "../repository/userPlatform.repo.ts";
import { upsertDailyCount } from "../repository/dailyCount.repo.ts";
import { getLeetCodeHeatmap } from "../services/leetcode/client.ts";
import { getUserStreak, upsertUserStreak } from "../repository/streak.repo.ts";

/**
 * Refreshes the daily_count (heatmap) table for all users by combining:
 * - LeetCode: fetched directly from LeetCode's submissionCalendar GraphQL API
 * - Codeforces & AtCoder: aggregated from local solved_problems table
 *
 * The three per-platform maps are merged (summed) per date, then upserted
 * into daily_count.
 *
 * Run: bun run scripts/refreshHeatmap.ts
 */

/**
 * Merge multiple date→count maps by summing counts for each date.
 */
const mergeMaps = (...maps: Map<string, number>[]): Map<string, number> => {
    const merged = new Map<string, number>();

    for (const map of maps) {
        for (const [date, count] of map) {
            merged.set(date, (merged.get(date) ?? 0) + count);
        }
    }

    return merged;
};

/**
 * Refresh heatmap data for a single user.
 * Also updates longest_streak using LeetCode's API streak value.
 */
const refreshHeatmapForUser = async (user_id: string): Promise<number> => {
    const platforms = await getUserPlatforms(user_id);
    const maps: Map<string, number>[] = [];
    let lcStreak = 0;

    // Date range: we go back ~1 year to cover the full heatmap
    const now = new Date();
    const oneYearAgo = new Date(now);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const fromDate = oneYearAgo.toISOString().split("T")[0]!;
    const toDate = now.toISOString().split("T")[0]!;
    // `user-streak.updated_on` means "confirmed through this date" (see
    // jobs/streak.ts) and never includes today — mirror that here so a
    // brand-new streak row created by this script doesn't get skipped by a
    // later streak.ts run that thinks today is already confirmed.
    const yesterdayDate = new Date(now);
    yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
    const yesterday = yesterdayDate.toISOString().split("T")[0]!;

    // LeetCode: fetch from API
    if (platforms["leetcode"]) {
        try {
            const lcResult = await getLeetCodeHeatmap(platforms["leetcode"]);
            maps.push(lcResult.heatmap);
            lcStreak = lcResult.streak;
            console.log(`  [leetcode] ${platforms["leetcode"]}: ${lcResult.heatmap.size} days with activity, streak=${lcStreak}`);
        } catch (error) {
            if (error instanceof Error) {
                console.error(`  [leetcode] Failed to fetch heatmap: ${error.message}`);
            }
        }
    }

    // Codeforces: aggregate from local DB
    if (platforms["codeforces"]) {
        try {
            const cfMap = await getPlatformSolvedCountsByDate(user_id, "codeforces", fromDate, toDate);
            maps.push(cfMap);
            console.log(`  [codeforces] ${platforms["codeforces"]}: ${cfMap.size} days with activity`);
        } catch (error) {
            if (error instanceof Error) {
                console.error(`  [codeforces] Failed to fetch heatmap: ${error.message}`);
            }
        }
    }

    // AtCoder: aggregate from local DB
    if (platforms["atcoder"]) {
        try {
            const atcMap = await getPlatformSolvedCountsByDate(user_id, "atcoder", fromDate, toDate);
            maps.push(atcMap);
            console.log(`  [atcoder] ${platforms["atcoder"]}: ${atcMap.size} days with activity`);
        } catch (error) {
            if (error instanceof Error) {
                console.error(`  [atcoder] Failed to fetch heatmap: ${error.message}`);
            }
        }
    }

    // Merge all platform maps
    const merged = mergeMaps(...maps);

    // Upsert each date into daily_count
    for (const [date, solved] of merged) {
        await upsertDailyCount(user_id, date, solved);
    }

    // Update longest_streak: max of LeetCode API streak and existing DB value
    if (lcStreak > 0) {
        const existingStreak = await getUserStreak(user_id);
        const dbLongest = existingStreak?.longest_streak ?? 0;
        const dbCurrent = existingStreak?.curr_streak ?? 0;
        const newLongest = Math.max(lcStreak, dbLongest);

        if (newLongest !== dbLongest) {
            await upsertUserStreak(
                user_id,
                dbCurrent,
                newLongest,
                existingStreak?.updated_on ?? yesterday
            );
            console.log(`  [streak] longest_streak updated: ${dbLongest} → ${newLongest} (LC API streak=${lcStreak})`);
        }
    }

    return merged.size;
};
/**
 * Get per-day solved counts for a specific platform from the local DB.
 * Uses the solved_problems table filtered by platform.
 */

const getPlatformSolvedCountsByDate = async (
    user_id: string,
    platform: string,
    fromDate: string,
    toDate: string
): Promise<Map<string, number>> => {
    const counts = new Map<string, number>();
    const pageSize = 1000;
    let offset = 0;

    while (true) {
        const { data, error } = await supabase
            .from("solved_problems")
            .select("solved_date")
            .eq("user_id", user_id)
            .eq("platform", platform)
            .gte("solved_date", fromDate)
            .lte("solved_date", toDate)
            .range(offset, offset + pageSize - 1);

        if (error) {
            throw new Error(
                `Error fetching solved problems for ${user_id}/${platform}: ${error.message}`
            );
        }

        if (!data.length) break;

        for (const row of data) {
            if (!row.solved_date) continue;
            counts.set(row.solved_date, (counts.get(row.solved_date) ?? 0) + 1);
        }

        if (data.length < pageSize) break;
        offset += pageSize;
    }

    return counts;
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

