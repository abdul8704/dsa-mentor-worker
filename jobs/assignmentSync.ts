import { getUserSolvedProblems } from "../repository/solvedProblems.repo.ts";
import { getPendingAssignments, markAssignmentsAutoCompleted } from "../repository/assignments.repo.ts";

/**
 * Auto-complete assignments for a mentee based on their synced solved problems.
 *
 * Called after the mentee's solved_problems are refreshed. For every pending
 * assignment whose problem_id now appears in the mentee's solved set, we flip
 * the assignment to completed (completed_via = 'auto').
 *
 * This is best-effort and must never break the surrounding refresh pipeline —
 * errors are caught and logged, and it returns the number of auto-completed
 * assignments for observability.
 */
export const syncAssignmentCompletions = async (user_id: string): Promise<number> => {
    try {
        const pending = await getPendingAssignments(user_id);

        if (pending.length === 0) {
            // Common case (no assignments) — keep it quiet but traceable.
            return 0;
        }

        const solved = await getUserSolvedProblems(user_id);

        const toComplete = pending.filter((a) => solved.has(a.problem_id)).map((a) => a.id);

        if (toComplete.length === 0) {
            console.log(`[AssignmentSync] ${user_id}: ${pending.length} pending, none newly solved`);
            return 0;
        }

        await markAssignmentsAutoCompleted(toComplete);
        console.log(`[AssignmentSync] ${user_id}: auto-completed ${toComplete.length}/${pending.length} assignments`);
        return toComplete.length;
    } catch (error) {
        // Never let assignment sync failures abort the refresh pipeline.
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[AssignmentSync] Failed for ${user_id}: ${message}`);
        return 0;
    }
};
