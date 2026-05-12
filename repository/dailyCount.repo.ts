import { supabase } from "../db/supabase.ts";
import type { UpsertDailyCountResult } from "../types/response.ts";

/**
 * Count new problems solved by a user on a specific date.
 * "New" means already_solved = false in solved_problems.
 * Counts across all platforms.
 */
export const getNewSolvedCountForDate = async (user_id: string, date: string): Promise<number> => {
    const { count, error } = await supabase
        .from("solved_problems")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user_id)
        .eq("already_solved", false)
        .eq("solved_date", date);

    if (error)
        throw new Error(`Error counting new solved problems for ${user_id} on ${date}: ${error.message}`);

    return count ?? 0;
};

/**
 * Upsert a daily count entry. If a row for (user_id, date) exists, update it.
 * Otherwise insert a new row.
 */
export const upsertDailyCount = async (user_id: string, date: string, solved: number): Promise<UpsertDailyCountResult> => {
    const { error } = await supabase
        .from("daily_count")
        .upsert(
            { user_id, date, solved },
            { onConflict: "user_id, date" }
        );

    if (error)
        throw new Error(`Error upserting daily count for ${user_id} on ${date}: ${error.message}`);

    return { success: true, user_id, date, solved };
};

/**
 * Get daily counts for a user in a date range [fromDate, toDate] inclusive.
 * Returns an array of { date, solved } sorted by date ascending.
 * Missing dates are NOT included — caller should treat missing dates as 0.
 */
export const getDailyCounts = async (
    user_id: string,
    fromDate: string,
    toDate: string
): Promise<{ date: string; solved: number }[]> => {
    const { data, error } = await supabase
        .from("daily_count")
        .select("date, solved")
        .eq("user_id", user_id)
        .gte("date", fromDate)
        .lte("date", toDate)
        .order("date", { ascending: true });

    if (error)
        throw new Error(`Error fetching daily counts for ${user_id} from ${fromDate} to ${toDate}: ${error.message}`);

    return data.map((row) => ({
        date: row.date,
        solved: row.solved ?? 0,
    }));
};
