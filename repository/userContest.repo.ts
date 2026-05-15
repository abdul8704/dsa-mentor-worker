import { supabase } from "../db/supabase.ts";
import type { Database } from "../types/db.ts";
import type { UpsertUserContestsResult } from "../types/response.ts";

export type UserContestInsert = Database["public"]["Tables"]["user_contest"]["Insert"];

export const getUserContestIds = async (user_id: string, platform: string): Promise<Set<string>> => {
    const { data, error } = await supabase
        .from("user_contest")
        .select("contest_id")
        .eq("user_id", user_id)
        .eq("platform", platform);

    if (error) {
        throw new Error(`Error while fetching user contests for ${user_id}: ${error.message}`);
    }

    return new Set(data.map((row) => row.contest_id));
};

export const upsertUserContests = async (rows: UserContestInsert[]): Promise<UpsertUserContestsResult> => {
    if (rows.length === 0) {
        return { success: true, upsertedCount: 0 };
    }

    const { error } = await supabase
        .from("user_contest")
        .upsert(rows, {
            onConflict: "user_id,contest_id,platform",
        });

    if (error) {
        throw new Error(`Error while upserting user contests: ${error.message}`);
    }

    return { success: true, upsertedCount: rows.length };
};
