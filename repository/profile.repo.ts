import { supabase } from "../db/supabase.ts";

export const getAllUsers = async (): Promise<string[]> => {
    const { data, error } = await supabase
                                .from("profile")
                                .select("user_id");

    if(error)
        throw new Error(`Error while fetching users ${error.message}`);

    return data.map((user) => user.user_id).filter((id): id is string => id !== null);
}