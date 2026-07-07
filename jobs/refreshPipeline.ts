import { refreshUser } from "./problemSolved.ts";
import { refreshUserContests } from "./contestRefresh.ts";
import { updateDailyCountForUser } from "./dailyCount.ts";
import { updateStreakForUser } from "./streak.ts";
import { syncAssignmentCompletions } from "./assignmentSync.ts";
import { getAllUsers, updateLastRefreshed } from "../repository/profile.repo.ts";

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

export type RefreshResult = { success: boolean; message: string };

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
export const runFullRefreshForUser = async (user_id: string): Promise<RefreshResult> => {
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

/**
 * Run the full refresh pipeline for every user in the system, one at a time
 * (sequential, to stay friendly to third-party platform rate limits).
 */
export const runFullRefreshForAllUsers = async (): Promise<{
    total: number;
    processed: number;
    failed: number;
}> => {
    const users = await getAllUsers();
    console.log(`[Refresh] Running full refresh for ${users.length} users...`);

    let processed = 0;
    let failed = 0;

    for (const user_id of users) {
        try {
            const result = await runFullRefreshForUser(user_id);
            if (result.success) {
                processed++;
            } else {
                failed++;
                console.error(`[Refresh] ${user_id} finished with errors: ${result.message}`);
            }
        } catch (error: unknown) {
            failed++;
            const message = error instanceof Error ? error.message : "Unknown error";
            console.error(`[Refresh] ${user_id} threw unexpectedly: ${message}`);
        }
    }

    console.log(`[Refresh] Full refresh complete. total=${users.length} processed=${processed} failed=${failed}`);
    return { total: users.length, processed, failed };
};
