import { Router } from "express";
import { supabase } from "../db/supabase.ts";
import { verifyCsesSession, loginWithPassword, CSESAuthError } from "../services/cses/client.ts";
import { getPlatformSecret, upsertPlatformSecret } from "../repository/userPlatformSecrets.repo.ts";
import { getUserPlatforms } from "../repository/userPlatform.repo.ts";
import { purgePlatformData } from "../jobs/handleChange.ts";
import { setupUser } from "../jobs/problemSolved.ts";
import { updateLastRefreshed } from "../repository/profile.repo.ts";
import { platformMain } from "../scripts/refreshPlatformData.ts";
import { heatMapMain } from "../scripts/refreshHeatmap.ts";
import { backfillMain } from "../scripts/backfillDailyCount.ts";

export const csesRouter = Router();

/**
 * CSES connects via a session cookie, never a bare handle, so it can't go
 * through profile.actions.ts's generic addPlatformHandles path the other
 * three platforms use (see routes/refresh.ts's /fresh-init exclusion) —
 * this upserts the user_platforms row (handle = the verified CSES username,
 * kept only for display/logging) directly instead.
 */
const upsertCsesHandle = async (user_id: string, username: string): Promise<void> => {
    const { error } = await supabase
        .from("user_platforms")
        .upsert(
            { user_id, platform: "cses", handle: username, last_synced_at: new Date().toISOString() },
            { onConflict: "user_id,platform" }
        );
    if (error) {
        throw new Error(`Error saving CSES handle for ${user_id}: ${error.message}`);
    }
};

// ──────────────────────────────────────────────────────
// POST /cses/connect — verify + store a mentee's CSES session, then import
// their solved-problem history in the background.
// Body: { "user_id": "...", "cookie": "<PHPSESSID value>" }
// ──────────────────────────────────────────────────────
csesRouter.post("/connect", async (req, res) => {
    const user_id = req.body?.user_id;
    const cookie = req.body?.cookie;
    const username = req.body?.username;
    const password = req.body?.password;

    if (typeof user_id !== "string" || !user_id.trim()) {
        res.status(400).json({ error: "user_id is required in the request body" });
        return;
    }

    const hasCookie = typeof cookie === "string" && cookie.trim().length > 0;
    const hasCredentials = typeof username === "string" && username.trim().length > 0
        && typeof password === "string" && password.trim().length > 0;

    if (!hasCookie && !hasCredentials) {
        res.status(400).json({ error: "Provide either a session cookie, or a username and password." });
        return;
    }

    const cleanedUserId = user_id.trim();

    try {
        let cleanedCookie: string;
        let account: Awaited<ReturnType<typeof verifyCsesSession>>;

        let cleanedUsername: string | null = null;
        let cleanedPassword: string | null = null;

        if (hasCookie) {
            console.log(`[CSES] POST /cses/connect — verifying session cookie for user_id=${cleanedUserId}`);
            // Accept a bare PHPSESSID value, "PHPSESSID=...", or a full cookie header.
            cleanedCookie = (cookie as string).trim().replace(/^PHPSESSID=/i, "").split(";")[0]!.trim();
            account = await verifyCsesSession(cleanedCookie);
        } else {
            console.log(`[CSES] POST /cses/connect — logging in with username/password for user_id=${cleanedUserId}`);
            cleanedUsername = (username as string).trim();
            cleanedPassword = (password as string).trim();
            // Verify the credentials work before storing anything (same as
            // the cookie path's verifyCsesSession above) — the resulting
            // cookie itself isn't stored; the username/password are (see
            // below), so every scheduled refresh logs in fresh instead of
            // relying on a cached cookie.
            const loginResult = await loginWithPassword(cleanedUsername, cleanedPassword);
            cleanedCookie = loginResult.cookie;
            account = loginResult.account;
        }

        const existingPlatforms = await getUserPlatforms(cleanedUserId);
        const priorHandle = existingPlatforms["cses"];
        const isAccountSwitch = Boolean(priorHandle) && priorHandle !== account.username;

        if (isAccountSwitch) {
            // A genuinely different CSES account, not just a refreshed
            // cookie for the same one — the old account's rows can't be
            // told apart from the new one's (both keyed by user_id+platform
            // only), so they must be purged before importing the new one.
            console.log(
                `[CSES] user=${cleanedUserId} switching CSES account "${priorHandle}" -> "${account.username}"; purging old data`
            );
            await purgePlatformData(cleanedUserId, "cses");
        }

        await upsertCsesHandle(cleanedUserId, account.username);
        // Store the secret *after* any purge above — purgePlatformData
        // deletes the stored secret for "cses" as part of the platform wipe,
        // and would otherwise delete the one just saved for the new account.
        //
        // Password mode stores the username+password (encrypted, same as a
        // cookie), NOT the one-off cookie from the verification login above
        // — services/cses/client.ts's requireActiveSession logs in fresh on
        // every scheduled refresh for a "password" kind secret, which is the
        // entire point: syncing never has to stop and wait for the mentee to
        // re-paste an expired cookie.
        if (cleanedUsername !== null && cleanedPassword !== null) {
            await upsertPlatformSecret(
                cleanedUserId,
                "cses",
                JSON.stringify({ username: cleanedUsername, password: cleanedPassword }),
                "password"
            );
        } else {
            await upsertPlatformSecret(cleanedUserId, "cses", cleanedCookie, "cookie");
        }

        // Respond immediately — the import itself can take minutes for a
        // long-time CSES user (see services/cses/client.ts), well past any
        // reasonable client timeout.
        res.json({
            success: true,
            message: "CSES account connected. Your solved problems are being imported in the background.",
            username: account.username,
        });

        // Mirrors /refresh/fresh-init's background chain for the other
        // platforms, minus contest refresh (CSES has no contests/rating).
        setupUser(cleanedUserId, ["cses"])
            .then(() => Promise.all([platformMain(cleanedUserId), heatMapMain(cleanedUserId), backfillMain(cleanedUserId)]))
            .then(() => updateLastRefreshed(cleanedUserId))
            .then(() => console.log(`[CSES] Background import complete for ${cleanedUserId}`))
            .catch((error: unknown) => {
                console.error(
                    `[CSES] Background import failed for ${cleanedUserId}: ${error instanceof Error ? error.message : error}`
                );
            });
    } catch (error: unknown) {
        if (error instanceof CSESAuthError) {
            // Not the mentee's fault necessarily (a stale/expired cookie is
            // the common case) — 422 rather than 500, with a message the
            // onboarding UI can show directly.
            res.status(422).json({ error: error.message });
            return;
        }
        const message = error instanceof Error ? error.message : "Internal server error";
        console.error(`[CSES] connect failed for ${cleanedUserId}: ${message}`);
        res.status(500).json({ error: message });
    }
});

// ──────────────────────────────────────────────────────
// GET /cses/status?user_id=... — lets the dashboard show "needs reauth"
// distinctly from "never connected", without exposing the stored secret.
// ──────────────────────────────────────────────────────
csesRouter.get("/status", async (req, res) => {
    const user_id = req.query.user_id;

    if (typeof user_id !== "string" || !user_id.trim()) {
        res.status(400).json({ error: "user_id query parameter is required" });
        return;
    }

    try {
        const secret = await getPlatformSecret(user_id.trim(), "cses");
        res.json(
            secret
                ? { connected: true, status: secret.status, lastVerifiedAt: secret.lastVerifiedAt }
                : { connected: false }
        );
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Failed to fetch CSES connection status";
        res.status(500).json({ error: message });
    }
});
