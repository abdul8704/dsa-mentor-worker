import { supabase } from "../db/supabase.ts"
import type { Database } from "../types/db.ts"

type UserPlatform = Database["public"]["Tables"]["user_platforms"]["Row"]

export const getUserPlatforms = async (user_id: string): Promise<Record<string, string>> => {
    const { data, error } = await supabase
                                .from("user_platforms")
                                .select("*")
                                .eq("user_id", user_id);
    if (error) {
        throw new Error(`Failed to fetch user platforms for ${user_id}: ${error.message}`);
    }

    let platformHandles: Record<string, string> = {};

    data.forEach((entry: UserPlatform) => {
        platformHandles[entry.platform] = entry.handle;
    }); 

    return platformHandles
}