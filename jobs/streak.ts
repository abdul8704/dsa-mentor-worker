import { getDailyCounts } from "../repository/dailyCount.repo.ts";
import { getUserStreak, upsertUserStreak } from "../repository/streak.repo.ts";
import { getAllUsers } from "../repository/profile.repo.ts";

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
 * Algorithm:
 * 1. Fetch existing streak row (or treat as fresh if none).
 * 2. Determine the scan window: from (updated_on + 1) to yesterday.
 *    - If no updated_on (first time), scan all daily_count history.
 * 3. Walk day-by-day through the window:
 *    - solved > 0 → extend streak
 *    - solved = 0 → update longest_streak = max(longest, curr), then reset curr to 0
 * 4. Handle today: if today's count > 0, extend streak (but 0 doesn't break it).
 * 5. Final longest_streak = max(longest, curr).
 * 6. Upsert to user-streak with updated_on = today.
 */
export const updateStreakForUser = async (user_id: string): Promise<void> => {
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
    } else if (updatedOn >= today) {
        // Already updated today, nothing to do
        console.log(`[Streak] ${user_id}: already updated today (${today})`);
        return;
    } else {
        // Start from the day after last update
        scanStart = addDays(updatedOn, 1);
    }

    // Fetch daily counts from scanStart to today (inclusive, to include today's count)
    const dailyCounts = await getDailyCounts(user_id, scanStart, today);

    // Build a map for quick lookup: date -> solved count
    const countMap = new Map<string, number>();
    for (const entry of dailyCounts) {
        countMap.set(entry.date, entry.solved);
    }

    // Walk day-by-day from scanStart to yesterday
    // Only dates up to yesterday can break the streak
    if (scanStart <= yesterday) {
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
    }

    // Handle today: can only extend, never break
    const todaySolved = countMap.get(today) ?? 0;
    if (todaySolved > 0) {
        currStreak++;
    }

    // Final longest check
    longestStreak = Math.max(longestStreak, currStreak);

    // Upsert
    await upsertUserStreak(user_id, currStreak, longestStreak, today);

    console.log(
        `[Streak] ${user_id}: curr=${currStreak}, longest=${longestStreak}, updated=${today}`
    );
};

/**
 * Compute and update streaks for all users.
 */
export const updateStreakForAllUsers = async (): Promise<void> => {
    const users = await getAllUsers();

    for (const user_id of users) {
        try {
            await updateStreakForUser(user_id);
        } catch (error) {
            if (error instanceof Error) {
                console.error(`[Streak] Failed for ${user_id}: ${error.message}`);
            } else {
                console.error(`[Streak] Failed for ${user_id}`);
            }
        }
    }
};
