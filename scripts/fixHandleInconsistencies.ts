import { resyncAfterHandleChange } from "../jobs/handleChange.ts";

/**
 * One-off maintenance script to repair data that was imported under a handle
 * that has since changed (before the automatic handle-change resync existed).
 *
 * It purges the affected platforms' data for a user and rebuilds every derived
 * aggregate from the current handles — leaving the DB in a consistent state.
 *
 * Usage:
 *   tsx scripts/fixHandleInconsistencies.ts <user_id> <platform[,platform...]>
 *
 * Example:
 *   tsx scripts/fixHandleInconsistencies.ts f312f12e-... leetcode
 */

const [, , userIdArg, platformsArg] = process.argv;

const user_id = userIdArg?.trim();
const platforms = (platformsArg ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

if (!user_id || platforms.length === 0) {
    console.error(
        "Usage: tsx scripts/fixHandleInconsistencies.ts <user_id> <platform[,platform...]>"
    );
    process.exit(1);
}

console.log(`[FixHandles] Repairing user=${user_id} platforms=${platforms.join(", ")}`);

try {
    await resyncAfterHandleChange(user_id, platforms);
    console.log("[FixHandles] Done.");
    process.exit(0);
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[FixHandles] Failed: ${message}`);
    process.exit(1);
}
