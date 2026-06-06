import { supabase } from "../db/supabase.ts";

export const getAllUsers = async (): Promise<string[]> => {
    const { data, error } = await supabase
                                .from("profile")
                                .select("user_id");

    if(error)
        throw new Error(`Error while fetching users ${error.message}`);

    return data.map((user) => user.user_id).filter((id): id is string => id !== null);
}

/**
 * Get user_ids of all users whose last_refreshed is more than 24 hours ago,
 * or whose last_refreshed is null (never refreshed).
 */
export const getStaleUsers = async (): Promise<string[]> => {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Users with last_refreshed < 24h ago
    const { data: staleData, error: staleError } = await supabase
        .from("profile")
        .select("user_id")
        .lt("last_refreshed", twentyFourHoursAgo);

    if (staleError)
        throw new Error(`Error fetching stale users: ${staleError.message}`);

    // Users with last_refreshed = null (never refreshed)
    const { data: nullData, error: nullError } = await supabase
        .from("profile")
        .select("user_id")
        .is("last_refreshed", null);

    if (nullError)
        throw new Error(`Error fetching null-refreshed users: ${nullError.message}`);

    const allIds = [
        ...(staleData ?? []).map((u) => u.user_id),
        ...(nullData ?? []).map((u) => u.user_id),
    ];

    return allIds.filter((id): id is string => id !== null);
}

/**
 * Update the last_refreshed timestamp for a user to now.
 */
export const updateLastRefreshed = async (user_id: string): Promise<void> => {
    const { error } = await supabase
        .from("profile")
        .update({ last_refreshed: new Date().toISOString() })
        .eq("user_id", user_id);

    if (error)
        throw new Error(`Error updating last_refreshed for ${user_id}: ${error.message}`);
}