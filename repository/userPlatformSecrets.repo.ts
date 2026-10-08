import { supabase } from "../db/supabase.ts";
import { encryptSecret, decryptSecret } from "../utils/crypto.ts";

export type SecretStatus = "active" | "needs_reauth" | "expired";

export type SecretKind = "cookie" | "password";

export type PlatformSecret = {
    value: string;
    kind: SecretKind;
    status: SecretStatus;
    lastVerifiedAt: string | null;
};

/** Fetches and decrypts the stored secret for (user_id, platform). Null if none is stored. */
export const getPlatformSecret = async (user_id: string, platform: string): Promise<PlatformSecret | null> => {
    const { data, error } = await supabase
        .from("user_platform_secrets")
        .select("encrypted_value, kind, status, last_verified_at")
        .eq("user_id", user_id)
        .eq("platform", platform)
        .maybeSingle();

    if (error) {
        throw new Error(`Error fetching ${platform} secret for ${user_id}: ${error.message}`);
    }
    if (!data) {
        return null;
    }

    return {
        value: decryptSecret(data.encrypted_value),
        kind: data.kind as SecretKind,
        status: data.status as SecretStatus,
        lastVerifiedAt: data.last_verified_at,
    };
};

/** Whether any secret is stored for (user_id, platform) — without decrypting it. */
export const hasPlatformSecret = async (user_id: string, platform: string): Promise<boolean> => {
    const { data, error } = await supabase
        .from("user_platform_secrets")
        .select("platform")
        .eq("user_id", user_id)
        .eq("platform", platform)
        .maybeSingle();

    if (error) {
        throw new Error(`Error checking ${platform} secret for ${user_id}: ${error.message}`);
    }
    return Boolean(data);
};

/** Encrypts and stores/replaces the secret for (user_id, platform), marking it freshly verified. */
export const upsertPlatformSecret = async (
    user_id: string,
    platform: string,
    value: string,
    kind: "cookie" | "password" = "cookie"
): Promise<void> => {
    const now = new Date().toISOString();
    const { error } = await supabase.from("user_platform_secrets").upsert(
        {
            user_id,
            platform,
            kind,
            encrypted_value: encryptSecret(value),
            status: "active",
            last_verified_at: now,
            updated_at: now,
        },
        { onConflict: "user_id,platform" }
    );

    if (error) {
        throw new Error(`Error storing ${platform} secret for ${user_id}: ${error.message}`);
    }
};

/** Flags a stored secret as no longer working, without deleting it (the mentee's old cookie stays visible as "needs reauth" rather than silently disappearing). */
export const markPlatformSecretStatus = async (
    user_id: string,
    platform: string,
    status: SecretStatus
): Promise<void> => {
    const { error } = await supabase
        .from("user_platform_secrets")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("user_id", user_id)
        .eq("platform", platform);

    if (error) {
        throw new Error(`Error updating ${platform} secret status for ${user_id}: ${error.message}`);
    }
};

export const deletePlatformSecret = async (user_id: string, platform: string): Promise<void> => {
    const { error } = await supabase
        .from("user_platform_secrets")
        .delete()
        .eq("user_id", user_id)
        .eq("platform", platform);

    if (error) {
        throw new Error(`Error deleting ${platform} secret for ${user_id}: ${error.message}`);
    }
};
