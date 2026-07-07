import { Router } from "express";
import { setupUser } from "../jobs/problemSolved.ts";
import { resyncAfterHandleChange } from "../jobs/handleChange.ts";
import { refreshUserContests } from "../jobs/contestRefresh.ts";
import { runFullRefreshForUser } from "../jobs/refreshPipeline.ts";
import { getStaleUsers } from "../repository/profile.repo.ts";
import { getUserPlatforms } from "../repository/userPlatform.repo.ts";
import { platformMain } from "../scripts/refreshPlatformData.ts";
import { heatMapMain } from "../scripts/refreshHeatmap.ts";
import { backfillMain } from "../scripts/backfillDailyCount.ts";
import { verifyHandles } from "../services/handleVerification.ts";

export const refreshRouter = Router();

// ──────────────────────────────────────────────────────
// POST /refresh/user — Refresh a single user by user_id
// Body: { "user_id": "..." }
// ──────────────────────────────────────────────────────
refreshRouter.post("/user", async (req, res) => {
    const user_id = req.body?.user_id;

    if (typeof user_id !== "string" || !user_id.trim()) {
        res.status(400).json({ error: "user_id is required in the request body" });
        return;
    }

    console.log(`[Refresh] POST /refresh/user — user_id=${user_id}`);

    try {
        const result = await runFullRefreshForUser(user_id.trim());
        const status = result.success ? 200 : 207; // 207 = multi-status (partial success)
        res.status(status).json(result);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Internal server error";
        res.status(500).json({ error: message });
    }
});

// ──────────────────────────────────────────────────────
// POST /refresh/stale — Refresh all users whose
// last_refreshed is more than 24 hours ago (or null)
// ──────────────────────────────────────────────────────
refreshRouter.post("/stale", async (_req, res) => {
    console.log("[Refresh] POST /refresh/stale — finding stale users...");

    try {
        const staleUsers = await getStaleUsers();

        if (staleUsers.length === 0) {
            res.json({ success: true, message: "No stale users found", processed: 0, failed: 0 });
            return;
        }

        console.log(`[Refresh] Found ${staleUsers.length} stale users.`);

        let processed = 0;
        let failed = 0;
        const results: { user_id: string; success: boolean; message: string }[] = [];

        for (const user_id of staleUsers) {
            try {
                const result = await runFullRefreshForUser(user_id);
                results.push({ user_id, ...result });

                if (result.success) {
                    processed++;
                } else {
                    failed++;
                }
            } catch (error: unknown) {
                failed++;
                const message = error instanceof Error ? error.message : "Unknown error";
                results.push({ user_id, success: false, message });
                console.error(`[Refresh] Stale refresh failed for ${user_id}: ${message}`);
            }
        }

        res.json({
            success: failed === 0,
            total: staleUsers.length,
            processed,
            failed,
            results,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Internal server error";
        res.status(500).json({ error: message });
    }
});

// ──────────────────────────────────────────────────────
// POST /refresh/handle-change — Purge + re-import data for
// platforms whose handle was just changed (or newly added),
// then rebuild all derived aggregates so the DB is consistent.
// Body: { "user_id": "...", "platforms": ["codeforces", ...] }
// ──────────────────────────────────────────────────────
refreshRouter.post("/handle-change", async (req, res) => {
    const user_id = req.body?.user_id;
    const platforms = req.body?.platforms;

    if (typeof user_id !== "string" || !user_id.trim()) {
        res.status(400).json({ error: "user_id is required in the request body" });
        return;
    }

    if (!Array.isArray(platforms) || platforms.some((p) => typeof p !== "string")) {
        res.status(400).json({ error: "platforms must be an array of strings" });
        return;
    }

    const cleanedPlatforms = [...new Set(platforms.map((p: string) => p.trim()).filter(Boolean))];

    console.log(`[HandleChange] POST /refresh/handle-change — user_id=${user_id} platforms=${cleanedPlatforms.join(", ")}`);

    if (cleanedPlatforms.length === 0) {
        res.json({ success: true, message: "No platforms to resync" });
        return;
    }

    // Fire-and-forget: the resync involves external API calls and can be slow.
    // Respond immediately so the client isn't blocked; the worker finishes in
    // the background.
    resyncAfterHandleChange(user_id.trim(), cleanedPlatforms)
        .then(() => console.log(`[HandleChange] Background resync done for ${user_id}`))
        .catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`[HandleChange] Background resync failed for ${user_id}: ${message}`);
        });

    res.json({ success: true, message: "Handle-change resync started", platforms: cleanedPlatforms });
});

// ──────────────────────────────────────────────────────
// POST /refresh/fresh-init — Verify the user's platform handles
// (fast, single request per platform) and respond immediately.
// The slow full-history import + aggregate rebuild for the handles
// that verified successfully runs afterwards in the background, so
// the client never has to wait through it (it can easily take well
// over the client's HTTP timeout for accounts with a long history).
// Body: { "user_id": "..." }
// ──────────────────────────────────────────────────────
refreshRouter.post("/fresh-init", async (req, res) => {
    const user_id = req.body?.user_id;

    if (typeof user_id !== "string" || !user_id.trim()) {
        res.status(400).json({ error: "user_id is required in the request body" });
        return;
    }

    const cleanedUserId = user_id.trim();

    try {
        console.log(`[Setup] POST /refresh/fresh-init — user_id=${cleanedUserId}`);

        const userPlatforms = await getUserPlatforms(cleanedUserId);

        if (Object.keys(userPlatforms).length === 0) {
            res.json({ success: true, message: "No platform handles to verify.", verified: [], invalid: [] });
            return;
        }

        const verifications = await verifyHandles(userPlatforms);
        const verifiedPlatforms = verifications.filter((v) => v.valid).map((v) => v.platform);
        const invalidHandles = verifications
            .filter((v) => !v.valid)
            .map(({ platform, handle, error }) => ({ platform, handle, error }));

        if (verifiedPlatforms.length === 0) {
            console.log(`[Setup] fresh-init: no handles verified for ${cleanedUserId}`);
            res.status(422).json({
                success: false,
                message: "None of the provided handles could be verified.",
                verified: [],
                invalid: invalidHandles,
            });
            return;
        }

        // Respond right away — verification is the only thing the client
        // waits on. Import + aggregation continue after the response is sent.
        res.json({
            success: true,
            message: "Handles verified. Your data is being imported in the background.",
            verified: verifiedPlatforms,
            invalid: invalidHandles,
        });

        setupUser(cleanedUserId, verifiedPlatforms)
            .then(() =>
                Promise.all([
                    platformMain(cleanedUserId),
                    heatMapMain(cleanedUserId),
                    backfillMain(cleanedUserId),
                    refreshUserContests(cleanedUserId),
                ])
            )
            .then(() => {
                console.log(`[Setup] Fresh init background import complete for ${cleanedUserId}`);
            })
            .catch((error) => {
                console.error(
                    `[Setup] Fresh init background import failed for ${cleanedUserId}: ${
                        error instanceof Error ? error.message : error
                    }`
                );
            });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Internal server error";
        console.error(`[Setup] fresh-init failed for ${cleanedUserId}: ${message}`);
        res.status(500).json({ error: message });
    }
});
