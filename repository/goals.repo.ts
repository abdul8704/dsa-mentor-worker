import { supabase } from "../db/supabase.ts";

/**
 * Problem ids in the user's revision goals whose window includes today
 * (see dsa-mentor-worker/supabase/migrations/20261012090000_goals.sql).
 * `prefix` narrows to one platform's ids, e.g. "CSES".
 */
export const getActiveRevisionProblemIds = async (user_id: string, prefix: string): Promise<Set<string>> => {
    const today = new Date().toISOString().slice(0, 10);

    const { data, error } = await supabase
        .from("goals")
        .select("goal_problems(problem_id)")
        .eq("user_id", user_id)
        .eq("kind", "revise")
        .lte("start_date", today)
        .gte("end_date", today);

    if (error) {
        throw new Error(`Error fetching revision goals for ${user_id}: ${error.message}`);
    }

    const ids = new Set<string>();
    for (const goal of (data ?? []) as unknown as { goal_problems: { problem_id: string }[] }[]) {
        for (const gp of goal.goal_problems ?? []) {
            if (gp.problem_id.startsWith(prefix)) ids.add(gp.problem_id);
        }
    }
    return ids;
};
