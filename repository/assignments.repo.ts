import { supabase } from "../db/supabase.ts";

/**
 * Repository for the `assignments` table (worker side).
 *
 * The worker uses the service-role client, so it bypasses RLS. These helpers
 * power auto-completion: after a mentee's solved problems are synced, any
 * pending assignment whose problem they've now solved is marked complete.
 */

export interface PendingAssignment {
    id: string;
    problem_id: string;
}

/** Fetch all still-pending assignments for a mentee (the person who solves). */
export const getPendingAssignments = async (mentee_id: string): Promise<PendingAssignment[]> => {
    const { data, error } = await supabase
        .from("assignments")
        .select("id, problem_id")
        .eq("mentee_id", mentee_id)
        .eq("status", "pending");

    if (error) {
        throw new Error(`Error fetching pending assignments for ${mentee_id}: ${error.message}`);
    }

    return data ?? [];
};

/** Mark the given assignment ids as auto-completed (idempotent on status). */
export const markAssignmentsAutoCompleted = async (ids: string[]): Promise<void> => {
    if (ids.length === 0) {
        return;
    }

    const { error } = await supabase
        .from("assignments")
        .update({
            status: "completed",
            completed_at: new Date().toISOString(),
            completed_via: "auto",
        })
        .in("id", ids)
        .eq("status", "pending"); // guard against racing a manual completion

    if (error) {
        throw new Error(`Error marking assignments completed: ${error.message}`);
    }
};
