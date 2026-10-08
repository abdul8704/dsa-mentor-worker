import { getPlatformSecret, markPlatformSecretStatus } from "../repository/userPlatformSecrets.repo.ts";
import { getLeetCodeDifficultyCounts } from "../services/leetcode/client.ts";
import {
    importLeetCodeHistory,
    isLeetCodeImportRunning,
    getLeetCodeImportState,
    setLeetCodeImportState,
    LeetCodeAuthError,
    type LeetCodeSession,
} from "../services/leetcode/history.ts";
import { rebuildDerivedDataForUser } from "./handleChange.ts";

/**
 * Full LeetCode update for one user, run in the background after the user
 * connects (or re-imports) from Settings:
 *
 *   1. Import every accepted submission since account creation into
 *      solved_problems (no duplicates — see importLeetCodeHistory).
 *   2. Rebuild everything derived from it from scratch: difficulty totals,
 *      daily_count / heatmap, 7/30-day counts, contests, streak, assignment
 *      auto-completion, last_refreshed (rebuildDerivedDataForUser).
 *
 * Returns false (and starts nothing) if an import is already running for
 * this user, so a double-click can't run two imports side by side.
 */
export const startLeetCodeFullImport = (user_id: string, handle: string): boolean => {
    if (isLeetCodeImportRunning(user_id)) return false;

    const startedAt = new Date().toISOString();
    const update = (patch: Partial<NonNullable<ReturnType<typeof getLeetCodeImportState>>>) => {
        const current = getLeetCodeImportState(user_id);
        if (current) setLeetCodeImportState(user_id, { ...current, ...patch });
    };

    setLeetCodeImportState(user_id, {
        state: "running",
        phase: "Starting",
        pages: 0,
        acceptedSeen: 0,
        summary: null,
        error: null,
        startedAt,
        finishedAt: null,
    });

    void (async () => {
        try {
            const secret = await getPlatformSecret(user_id, "leetcode");
            if (!secret) throw new LeetCodeAuthError("No LeetCode session keys are stored.");
            const session = JSON.parse(secret.value) as LeetCodeSession;

            // LeetCode's own distinct-solved count: used to detect and fill gaps.
            const target = await getLeetCodeDifficultyCounts(handle)
                .then((c) => c.total)
                .catch(() => null);

            const summary = await importLeetCodeHistory(user_id, session, target, (p) => update(p));
            update({ summary, phase: "Refreshing dashboard data" });

            await rebuildDerivedDataForUser(user_id);

            update({ state: "done", phase: "Done", finishedAt: new Date().toISOString() });
            console.log(`[LeetCodeImport] ${user_id}: done`, summary);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            if (error instanceof LeetCodeAuthError) {
                await markPlatformSecretStatus(user_id, "leetcode", "needs_reauth").catch(() => {});
            }
            update({ state: "failed", phase: "Failed", error: message, finishedAt: new Date().toISOString() });
            console.error(`[LeetCodeImport] ${user_id}: failed: ${message}`);
        }
    })();

    return true;
};
