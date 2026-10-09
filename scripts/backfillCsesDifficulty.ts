import { supabase } from "../db/supabase.ts";
import { fetchText } from "../utils/httpClient.ts";
import { parseTaskList } from "../services/cses/client.ts";
import { buildCsesDifficultyIndex } from "../utils/csesDifficulty.ts";
import { platformMain } from "./refreshPlatformData.ts";

/**
 * One-off: re-label every CSES row already in `problems` with
 * utils/csesDifficulty.ts's classifier (addProbs never overwrites, so rows
 * inserted under the old solve-rate buckets keep their old label otherwise),
 * then recompute every user's easy/medium/hard totals.
 *
 * Uses the public, logged-out problemset list — no mentee session needed.
 *
 * Run: npx tsx scripts/backfillCsesDifficulty.ts
 *      npx tsx scripts/backfillCsesDifficulty.ts --dry-run
 */
const dryRun = process.argv.includes("--dry-run");

const tasks = parseTaskList(await fetchText("https://cses.fi/problemset/list/", { label: "CSES problemset list" }));
if (tasks.length === 0) {
    console.error("[CsesDifficulty] Parsed 0 tasks from the CSES list; aborting.");
    process.exit(1);
}
const index = buildCsesDifficultyIndex(tasks);

const { data: rows, error } = await supabase
    .from("problems")
    .select("problem_id, difficulty")
    .eq("platform", "cses");
if (error) throw new Error(`Error fetching CSES problems: ${error.message}`);

const changes = (rows ?? []).flatMap((r) => {
    const next = index.get(Number(r.problem_id.replace(/^CSES/, "")));
    return next && next !== r.difficulty ? [{ ...r, next }] : [];
});

console.log(`[CsesDifficulty] ${tasks.length} tasks on CSES, ${rows?.length ?? 0} in problems, ${changes.length} to relabel`);
for (const c of changes) {
    console.log(`  ${c.problem_id}: ${c.difficulty} -> ${c.next}`);
}

if (dryRun) process.exit(0);

for (const c of changes) {
    const { error: updateError } = await supabase
        .from("problems")
        .update({ difficulty: c.next })
        .eq("problem_id", c.problem_id);
    if (updateError) throw new Error(`Error updating ${c.problem_id}: ${updateError.message}`);
}

await platformMain();
process.exit(0);
