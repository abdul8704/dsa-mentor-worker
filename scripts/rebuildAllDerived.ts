import { getAllUsers } from "../repository/profile.repo.ts";
import { rebuildDerivedDataForUser } from "../jobs/handleChange.ts";

/**
 * One-off: rebuild every derived table (daily_count/heatmap, difficulty
 * totals, contests, streak, assignment completion) for every user, using the
 * current definitions. Run after changing how any of them is computed —
 * e.g. the unified daily_count definition in jobs/dailyCount.ts.
 *
 * Run: npx tsx scripts/rebuildAllDerived.ts            (all users)
 *      npx tsx scripts/rebuildAllDerived.ts <user_id>  (one user)
 */
const only = process.argv[2];
const users = only ? [only] : await getAllUsers();
console.log(`[RebuildAll] ${users.length} user(s)`);

let failed = 0;
for (const user_id of users) {
    try {
        await rebuildDerivedDataForUser(user_id);
        console.log(`[RebuildAll] ${user_id}: done`);
    } catch (error) {
        failed++;
        console.error(`[RebuildAll] ${user_id}: failed: ${error instanceof Error ? error.message : error}`);
    }
}

console.log(`[RebuildAll] finished, failed=${failed}`);
process.exit(failed ? 1 : 0);
