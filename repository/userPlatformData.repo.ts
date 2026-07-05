import { supabase } from "../db/supabase.ts";
import type { Database } from "../types/db.ts";
import type { UpsertPlatformDataResult } from "../types/response.ts";

export type UserPlatformDataInsert = Omit<Database["public"]["Tables"]["user_platform_data"]["Insert"], "id"> & {
    id?: string;
};

export const deleteUserPlatformData = async (user_id: string, platform: string): Promise<void> => {
  const { error } = await supabase
    .from("user_platform_data")
    .delete()
    .eq("user_id", user_id)
    .eq("platform", platform);

  if (error) {
    throw new Error(
      `Error while deleting user platform data for ${user_id}/${platform}: ${error.message}`
    );
  }
};

export const upsertUserPlatformData = async (
  row: UserPlatformDataInsert
): Promise<UpsertPlatformDataResult> => {
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

  return { success: true, user_id: row.user_id, platform: row.platform };
};