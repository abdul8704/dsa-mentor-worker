import { supabase } from "../db/supabase.ts";
import type { Database } from "../types/db.ts"
import type { CodeforcesSolvedCountResponse } from "../types/platformResponse.ts";
import type { AddSolvedProblemsResult } from "../types/response.ts";

type CF_Insert = Database["public"]["Tables"]["solved_problems"]["Insert"]

export const getUserSolvedProblems = async (userid: string): Promise<Set<string>> => {
    const { data, error } = await supabase
                                .from("solved_problems")
                                .select('problem_id')
                                .eq("user_id", userid);

    if(error)
        throw new Error(`Error while fetching users solved problems ${error.message}`);

    let solvedSet = new Set<string>();

    data.forEach((prob) => solvedSet.add(prob.problem_id));

    return solvedSet;
}

export const getUserSolvedProblemsByDate = async (userid: string): Promise<Set<string>> => {
    const { data, error } = await supabase
                                .from("solved_problems")
                                .select('problem_id, solved_date')
                                .eq("user_id", userid);

    if(error)
        throw new Error(`Error while fetching users solved problems ${error.message}`);

    let solvedSet = new Set<string>();

    data.forEach((prob) => solvedSet.add(prob.problem_id + "-" + prob.solved_date));

    return solvedSet;
}

export const deleteSolvedProblemsForPlatform = async (user_id: string, platform: string): Promise<void> => {
    const { error } = await supabase
        .from("solved_problems")
        .delete()
        .eq("user_id", user_id)
        .eq("platform", platform);

    if (error)
        throw new Error(`Error while deleting solved problems for ${user_id}/${platform}: ${error.message}`);
}

export const addSolvedProblems = async (problems: CF_Insert[]): Promise<AddSolvedProblemsResult> => {
    if (problems.length === 0) {
        return { success: true, insertedCount: 0 };
    }

    const { error } = await supabase                                
                                .from("solved_problems")
                                .insert(problems);
    if(error)        
        throw new Error(`Error while inserting solved problems ${error.message}`);

    return { success: true, insertedCount: problems.length };
}

export const getSolvedCountsByDateInRange = async (
    user_id: string,
    fromDate: string,
    toDate: string
): Promise<Map<string, number>> => {
    const counts = new Map<string, number>();
    const pageSize = 1000;
    let offset = 0;

    while (true) {
        const { data, error } = await supabase
            .from("solved_problems")
            .select("solved_date")
            .eq("user_id", user_id)
            .gte("solved_date", fromDate)
            .lte("solved_date", toDate)
            .range(offset, offset + pageSize - 1);

        if (error) {
            throw new Error(`Error fetching solved problems for heatmap: ${error.message}`);
        }

        if (!data.length) {
            break;
        }

        for (const row of data) {
            if (!row.solved_date) {
                continue;
            }
            counts.set(row.solved_date, (counts.get(row.solved_date) ?? 0) + 1);
        }

        if (data.length < pageSize) {
            break;
        }

        offset += pageSize;
    }

    return counts;
};

export const getCodeforcesSolvedCount = async (user_id: string): Promise<number> => {
    const { data, error } = await supabase
        .from("solved_problems")
        .select('problem_id')
        .eq("user_id", user_id)
        .eq("platform", "codeforces");

    if(error)
        throw new Error(`Error while fetching solved count for ${user_id}: ${error.message}`);

    return new Set(data.map(d => d.problem_id)).size;
}
