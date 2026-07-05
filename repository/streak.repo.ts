import { supabase } from "../db/supabase.ts";
import type { Database } from "../types/db.ts";
import type { UpsertStreakResult } from "../types/response.ts";

type UserStreakRow = Database["public"]["Tables"]["user-streak"]["Row"];

/**
 * Fetch the current streak data for a user.
 * Returns null if no row exists yet.
 */
export const getUserStreak = async (
    user_id: string
): Promise<{ curr_streak: number; longest_streak: number; updated_on: string | null } | null> => {
    const { data, error } = await supabase
        .from("user-streak")
        .select("curr_streak, longest_streak, updated_on")
        .eq("user_id", user_id)
        .maybeSingle();

    if (error)
        throw new Error(`Error fetching streak for ${user_id}: ${error.message}`);

    if (!data) return null;

    return {
        curr_streak: data.curr_streak ?? 0,
        longest_streak: data.longest_streak ?? 0,
        updated_on: data.updated_on,
    };
};

/**
 * Delete the user's streak row so it can be recomputed from scratch.
 */
export const deleteUserStreak = async (user_id: string): Promise<void> => {
    const { error } = await supabase
        .from("user-streak")
        .delete()
        .eq("user_id", user_id);

    if (error)
        throw new Error(`Error deleting streak for ${user_id}: ${error.message}`);
};

/**
 * Upsert the user's streak data. If a row for user_id exists, update it.
 * Otherwise insert a new row.
 */
export const upsertUserStreak = async (
    user_id: string,
    curr_streak: number,
    longest_streak: number,
    updated_on: string
): Promise<UpsertStreakResult> => {
    const { error } = await supabase
        .from("user-streak")
        .upsert(
            { user_id, curr_streak, longest_streak, updated_on },
            { onConflict: "user_id" }
        );

    if (error)
        throw new Error(`Error upserting streak for ${user_id}: ${error.message}`);

    return { success: true, user_id, curr_streak, longest_streak, updated_on };
};
