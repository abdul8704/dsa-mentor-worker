import { Router } from "express";
import { refreshUser, setupUser } from "../jobs/problemSolved.ts";
import { resyncAfterHandleChange } from "../jobs/handleChange.ts";
import { refreshUserContests } from "../jobs/contestRefresh.ts";
import { updateDailyCountForUser } from "../jobs/dailyCount.ts";
import { updateStreakForUser } from "../jobs/streak.ts";
import { syncAssignmentCompletions } from "../jobs/assignmentSync.ts";
import { getStaleUsers, updateLastRefreshed } from "../repository/profile.repo.ts";
import { platformMain } from "../scripts/refreshPlatformData.ts";
import { heatMapMain } from "../scripts/refreshHeatmap.ts";
import { backfillMain } from "../scripts/backfillDailyCount.ts";

export const refreshRouter = Router();

/**
 * Helper: sleep for `ms` milliseconds.
 */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Checks if an error is a rate-limiting error (HTTP 429 or 503).
 */
const isRateLimitError = (error: unknown): boolean => {
    if (error instanceof Error) {
        const msg = error.message.toLowerCase();
        return msg.includes("429") || msg.includes("rate limit") || msg.includes("too many requests") || msg.includes("503");
    }
    return false;
};

/**
 * Run the full refresh pipeline for a single user:
 *   1. Platform data sync (solved problems)
 *   2. Contest data sync
 *   3. Daily count computation
 *   4. Streak computation
 *   5. Update last_refreshed timestamp
 *
 * If a rate-limiting error is encountered, waits 15 seconds and retries once.
 */
const runFullRefreshForUser = async (user_id: string): Promise<{ success: boolean; message: string }> => {
    const steps = [
        { name: "PlatformSync", fn: () => refreshUser(user_id) },
        { name: "ContestSync", fn: () => refreshUserContests(user_id) },
        { name: "DailyCount", fn: () => updateDailyCountForUser(user_id) },
        { name: "Streak", fn: () => updateStreakForUser(user_id) },
        // Auto-complete assignments once the freshest solved data is in.
        { name: "AssignmentSync", fn: () => syncAssignmentCompletions(user_id) },
    ];

    const errors: string[] = [];

    for (const step of steps) {
        try {
            await step.fn();
        } catch (error: unknown) {
            if (isRateLimitError(error)) {
                console.log(`[Refresh] ${user_id}: Rate limited during ${step.name}, retrying in 15s...`);
                await sleep(15_000);

                try {
                    await step.fn();
                } catch (retryError: unknown) {
                    const msg = retryError instanceof Error ? retryError.message : "Unknown error";
                    errors.push(`${step.name} (retry): ${msg}`);
                    console.error(`[Refresh] ${user_id}: ${step.name} retry failed: ${msg}`);
                }
            } else {
                const msg = error instanceof Error ? error.message : "Unknown error";
                errors.push(`${step.name}: ${msg}`);
                console.error(`[Refresh] ${user_id}: ${step.name} failed: ${msg}`);
            }
        }
    }

    // Update last_refreshed even on partial success
    try {
        await updateLastRefreshed(user_id);
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        errors.push(`UpdateLastRefreshed: ${msg}`);
    }

    if (errors.length > 0) {
        return { success: false, message: `Partial failure: ${errors.join("; ")}` };
    }

    return { success: true, message: "All steps completed successfully" };
};

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

refreshRouter.post("/fresh-init", async (req, res) => {
    const user_id = req.body?.user_id;
    try{
        console.log(`[Setup] POST /refresh/fresh-init — user_id=${user_id}`);
        await setupUser(user_id);

        Promise.all([
            platformMain(user_id),
            heatMapMain(user_id),
            backfillMain(user_id),
            refreshUserContests(user_id),
        ]).then(() => {
            console.log("[Setup] Fresh init completed for all scripts.");
        }).catch((error) => {
            console.error(`[Setup] Fresh init encountered an error: ${error instanceof Error ? error.message : error}`);
        });
        
        res.json({ success: true, message: "Fresh init completed successfully" });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Internal server error";
        res.status(500).json({ error: message });
    }
})
