import { deleteDailyCountsBefore, upsertDailyCounts } from "../repository/dailyCount.repo.ts";
import { getAllUsers } from "../repository/profile.repo.ts";
import { getSolvedDatesForUser } from "../repository/solvedProblems.repo.ts";
import { getUserPlatforms } from "../repository/userPlatform.repo.ts";
import { hasPlatformSecret } from "../repository/userPlatformSecrets.repo.ts";
import { getLeetCodeHeatmap } from "../services/leetcode/client.ts";
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

export type DailyCountRebuildResult = {
    days: number;
    todaySolved: number;
    /** LeetCode's own streak, only fetched when we fall back to its calendar (see below). */
    lcStreak: number;
};

/**
 * THE single definition of daily_count (heatmap, streaks):
 *
 *   solved(day) = number of problems accepted that day, across every
 *                 platform (one solved_problems row per problem per day;
 *                 re-solving a problem on a later day counts on that day).
 *
 * This matches the dashboard's "solved today" / 7-day / 30-day numbers,
 * which count solved_problems rows directly.
 *
 * Before this, three writers disagreed: the cron job counted only first-ever
 * solves, backfillDailyCount did the same, and refreshHeatmap counted LeetCode
 * *submissions* (wrong answers included) plus every solve on the other
 * platforms — and some callers ran the last two in parallel, so whichever
 * finished last won per day. All three now call this.
 *
 * LeetCode without stored session keys: solved_problems only holds the ~20
 * most recent LeetCode solves (public API limit), so for those users each
 * day's LeetCode share is max(our rows, LeetCode's public submission
 * calendar). The calendar counts submissions, not just accepted ones, so this
 * can overstate a little — but without it their older LeetCode activity would
 * vanish from the heatmap. With session keys, the full history is in
 * solved_problems and the calendar is not used.
 *
 * fromDate omitted = full rebuild from the first activity to today (and stale
 * rows before that are removed). fromDate given = only that window.
 * Every day in range is written, zeros included, so stale values get reset.
 */
export const rebuildDailyCounts = async (
    user_id: string,
    options: { fromDate?: string } = {}
): Promise<DailyCountRebuildResult> => {
    const today = getTodayUTC();
    const { fromDate } = options;

    const counts = new Map<string, number>();
    const leetcodeCounts = new Map<string, number>();
    const bump = (map: Map<string, number>, date: string, by = 1) => map.set(date, (map.get(date) ?? 0) + by);

    for (const row of await getSolvedDatesForUser(user_id, fromDate)) {
        if (!row.solved_date) continue;
        bump(row.platform === "leetcode" ? leetcodeCounts : counts, row.solved_date);
    }

    let lcStreak = 0;
    const leetcodeHandle = (await getUserPlatforms(user_id))["leetcode"];
    if (leetcodeHandle) {
        const hasSession = await hasPlatformSecret(user_id, "leetcode").catch(() => false);
        if (!hasSession) {
            try {
                const calendar = await getLeetCodeHeatmap(leetcodeHandle);
                lcStreak = calendar.streak;
                for (const [date, submissions] of calendar.heatmap) {
                    if (fromDate && date < fromDate) continue;
                    leetcodeCounts.set(date, Math.max(leetcodeCounts.get(date) ?? 0, submissions));
                }
            } catch (error) {
                console.warn(
                    `[DailyCount] ${user_id}: LeetCode calendar unavailable, using stored solves only: ${
                        error instanceof Error ? error.message : error
                    }`
                );
            }
        }
    }
    for (const [date, count] of leetcodeCounts) bump(counts, date, count);

    const firstActive = [...counts.keys()].filter((d) => d <= today).sort()[0];
    const start = fromDate ?? firstActive;
    if (!start) {
        return { days: 0, todaySolved: 0, lcStreak };
    }

    const rows: { user_id: string; date: string; solved: number }[] = [];
    for (let date = start; date <= today; date = addDays(date, 1)) {
        rows.push({ user_id, date, solved: counts.get(date) ?? 0 });
    }

    await upsertDailyCounts(rows);
    if (!fromDate) {
        await deleteDailyCountsBefore(user_id, start);
    }

    return { days: rows.length, todaySolved: counts.get(today) ?? 0, lcStreak };
};

/**
 * Cron step: recompute the last 7 days (not just today) so a day that
 * received late data — a solve after the previous run, a delayed CSES/
 * LeetCode sync — is corrected before streak.ts treats it as settled.
 */
export const updateDailyCountForUser = async (user_id: string): Promise<DailyCountUserResult> => {
    const today = getTodayUTC();
    const { todaySolved } = await rebuildDailyCounts(user_id, { fromDate: addDays(today, -6) });

    console.log(`[DailyCount] ${user_id}: ${todaySolved} problems solved on ${today} (last 7 days recomputed)`);
    return { success: true, user_id, date: today, solved: todaySolved };
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
