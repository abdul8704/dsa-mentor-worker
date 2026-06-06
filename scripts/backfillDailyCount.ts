import { supabase } from "../db/supabase.ts";
import { getNewSolvedCountForDate, upsertDailyCount } from "../repository/dailyCount.repo.ts";
import { getAllUsers } from "../repository/profile.repo.ts";
import type { BackfillUserResult, BackfillAllResult } from "../types/response.ts";

/**
 * Backfill script: populates the daily_count table for each user
 * from the earliest solved problem date to the latest existing daily_count date.
 * If no daily_count entries exist yet, backfills up to today.
 */

const getTodayUTC = (): string => new Date().toISOString().split("T")[0]!;

const addDays = (dateStr: string, days: number): string => {
    const date = new Date(dateStr + "T00:00:00Z");
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().split("T")[0]!;
};

/**
 * Get the earliest solved_date for a user from solved_problems.
 * Returns null if the user has no solved problems.
 */
const getEarliestSolvedDate = async (user_id: string): Promise<string | null> => {
    const { data, error } = await supabase
        .from("solved_problems")
        .select("solved_date")
        .eq("user_id", user_id)
        .eq("already_solved", false)
        .order("solved_date", { ascending: true })
        .limit(1)
        .maybeSingle();

    if (error)
        throw new Error(`Error fetching earliest solved date for ${user_id}: ${error.message}`);

    return data?.solved_date ?? null;
};

/**
 * Get the latest date in daily_count for a user.
 * Returns null if no entries exist.
 */
const getLatestDailyCountDate = async (user_id: string): Promise<string | null> => {
    const { data, error } = await supabase
        .from("daily_count")
        .select("date")
        .eq("user_id", user_id)
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error)
        throw new Error(`Error fetching latest daily_count date for ${user_id}: ${error.message}`);

    return data?.date ?? null;
};

/**
 * Backfill daily_count for a single user.
 * Fills from earliestSolvedDate up to (latestDailyCountDate - 1), or today if none exists.
 */
const backfillForUser = async (user_id: string): Promise<BackfillUserResult> => {
    const earliestDate = await getEarliestSolvedDate(user_id);
    if (!earliestDate) {
        console.log(`[Backfill] ${user_id}: no solved problems found, skipping.`);
        return { success: true, user_id, daysProcessed: 0 };
    }

    const latestDailyCount = await getLatestDailyCountDate(user_id);

    // End date: day before the latest daily_count entry (already exists), or today
    const endDate = latestDailyCount ? addDays(latestDailyCount, -1) : getTodayUTC();

    if (earliestDate > endDate) {
        console.log(`[Backfill] ${user_id}: nothing to backfill (earliest=${earliestDate}, end=${endDate}).`);
        return { success: true, user_id, daysProcessed: 0 };
    }

    console.log(`[Backfill] ${user_id}: backfilling from ${earliestDate} to ${endDate}...`);

    let currentDate = earliestDate;
    let daysProcessed = 0;

    while (currentDate <= endDate) {
        const count = await getNewSolvedCountForDate(user_id, currentDate);
        await upsertDailyCount(user_id, currentDate, count);
        daysProcessed++;

        if (daysProcessed % 30 === 0) {
            console.log(`[Backfill] ${user_id}: processed ${daysProcessed} days (at ${currentDate})...`);
        }

        currentDate = addDays(currentDate, 1);
    }

    console.log(`[Backfill] ${user_id}: done — ${daysProcessed} days backfilled.`);
    return { success: true, user_id, daysProcessed };
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

