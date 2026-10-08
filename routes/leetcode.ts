import { Router } from "express";
import { supabase } from "../db/supabase.ts";
import { getPlatformSecret, upsertPlatformSecret } from "../repository/userPlatformSecrets.repo.ts";
import { getUserPlatforms } from "../repository/userPlatform.repo.ts";
import { purgePlatformData } from "../jobs/handleChange.ts";
import { startLeetCodeFullImport } from "../jobs/leetcodeImport.ts";
import {
    normalizeLeetCodeSession,
    verifyLeetCodeSession,
    getLeetCodeImportState,
    isLeetCodeImportRunning,
    LeetCodeAuthError,
} from "../services/leetcode/history.ts";

export const leetcodeRouter = Router();

const upsertLeetCodeHandle = async (user_id: string, username: string): Promise<void> => {
    const { error } = await supabase
        .from("user_platforms")
        .upsert(
            { user_id, platform: "leetcode", handle: username, last_synced_at: new Date().toISOString() },
            { onConflict: "user_id,platform" }
        );
    if (error) {
        throw new Error(`Error saving LeetCode handle for ${user_id}: ${error.message}`);
    }
};

// ──────────────────────────────────────────────────────
// POST /leetcode/connect — verify + store the user's LeetCode session keys,
// then (in the background) import their full solve history and rebuild
// every derived table.
// Body: { "user_id": "...", "session": "<LEETCODE_SESSION>", "csrftoken": "<csrftoken>" }
// ──────────────────────────────────────────────────────
leetcodeRouter.post("/connect", async (req, res) => {
    const user_id = req.body?.user_id;
    const rawSession = req.body?.session;
    const rawCsrf = req.body?.csrftoken;

    if (typeof user_id !== "string" || !user_id.trim()) {
        res.status(400).json({ error: "user_id is required in the request body" });
        return;
    }
    if (typeof rawSession !== "string" || typeof rawCsrf !== "string") {
        res.status(400).json({ error: "Both LEETCODE_SESSION and csrftoken are required." });
        return;
    }

    const session = normalizeLeetCodeSession(rawSession, rawCsrf);
    if (!session) {
        res.status(400).json({ error: "Both LEETCODE_SESSION and csrftoken are required." });
        return;
    }

    const cleanedUserId = user_id.trim();

    if (isLeetCodeImportRunning(cleanedUserId)) {
        res.status(409).json({ error: "A LeetCode import is already running for this account. Wait for it to finish." });
        return;
    }

    try {
        console.log(`[LeetCode] POST /leetcode/connect — verifying session for user_id=${cleanedUserId}`);
        const username = await verifyLeetCodeSession(session);

        // The session proves which LeetCode account this is. If it differs
        // from the saved handle, the old account's rows can't be told apart
        // from the new one's, so wipe them before importing.
        const priorHandle = (await getUserPlatforms(cleanedUserId))["leetcode"];
        if (priorHandle && priorHandle.toLowerCase() !== username.toLowerCase()) {
            console.log(`[LeetCode] user=${cleanedUserId} switching "${priorHandle}" -> "${username}"; purging old data`);
            await purgePlatformData(cleanedUserId, "leetcode");
        }

        await upsertLeetCodeHandle(cleanedUserId, username);
        // After any purge (purge deletes the stored secret).
        await upsertPlatformSecret(cleanedUserId, "leetcode", JSON.stringify(session), "cookie");

        startLeetCodeFullImport(cleanedUserId, username);

        res.json({
            success: true,
            username,
            message: "LeetCode connected. Importing your full solve history and refreshing your dashboard in the background.",
        });
    } catch (error: unknown) {
        if (error instanceof LeetCodeAuthError) {
            res.status(422).json({ error: error.message });
            return;
        }
        const message = error instanceof Error ? error.message : "Internal server error";
        console.error(`[LeetCode] connect failed for ${cleanedUserId}: ${message}`);
        res.status(500).json({ error: message });
    }
});

// ──────────────────────────────────────────────────────
// POST /leetcode/resync — re-run the full import + refresh with the
// already-stored session keys. Body: { "user_id": "..." }
// ──────────────────────────────────────────────────────
leetcodeRouter.post("/resync", async (req, res) => {
    const user_id = req.body?.user_id;
    if (typeof user_id !== "string" || !user_id.trim()) {
        res.status(400).json({ error: "user_id is required in the request body" });
        return;
    }
    const cleanedUserId = user_id.trim();

    try {
        const secret = await getPlatformSecret(cleanedUserId, "leetcode");
        if (!secret) {
            res.status(404).json({ error: "No LeetCode session keys saved yet." });
            return;
        }
        if (secret.status !== "active") {
            res.status(422).json({ error: "Your LeetCode session has expired. Paste fresh session keys to continue." });
            return;
        }

        const handle = (await getUserPlatforms(cleanedUserId))["leetcode"];
        if (!handle) {
            res.status(404).json({ error: "No LeetCode handle saved for this account." });
            return;
        }

        if (!startLeetCodeFullImport(cleanedUserId, handle)) {
            res.status(409).json({ error: "A LeetCode import is already running for this account." });
            return;
        }

        res.json({ success: true, message: "Re-importing your LeetCode history in the background." });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Internal server error";
        res.status(500).json({ error: message });
    }
});

// ──────────────────────────────────────────────────────
// GET /leetcode/status?user_id=... — connection status + import progress.
// Never returns the stored keys.
// ──────────────────────────────────────────────────────
leetcodeRouter.get("/status", async (req, res) => {
    const user_id = req.query.user_id;
    if (typeof user_id !== "string" || !user_id.trim()) {
        res.status(400).json({ error: "user_id query parameter is required" });
        return;
    }

    try {
        const secret = await getPlatformSecret(user_id.trim(), "leetcode");
        const importState = getLeetCodeImportState(user_id.trim());
        res.json(
            secret
                ? { connected: true, status: secret.status, lastVerifiedAt: secret.lastVerifiedAt, import: importState }
                : { connected: false, import: importState }
        );
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Failed to fetch LeetCode connection status";
        res.status(500).json({ error: message });
    }
});
