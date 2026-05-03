import { supabase } from "../db/supabase.ts";
import type { Database } from "../types/db.ts";

export type UserPlatformDataInsert = Omit<Database["public"]["Tables"]["user_platform_data"]["Insert"], "id"> & {
    id?: string;
};

export const upsertUserPlatformData = async (
  row: UserPlatformDataInsert
): Promise<void> => {
  if (!row.user_id || !row.platform) {
    throw new Error("user_id and platform are required");
  }

  const values: Database["public"]["Tables"]["user_platform_data"]["Insert"] = {
    ...row,
    id: row.id ?? crypto.randomUUID(),
  };

  const { error } = await supabase
    .from("user_platform_data")
    .upsert(values, {
      onConflict: "user_id,platform"
    });

  if (error) {
    throw new Error(
      `Error while upserting user codeforces data for ${row.user_id}: ${error.message}`
    );
  }
};