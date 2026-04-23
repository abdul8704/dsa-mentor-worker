import { supabase } from "../db/supabase.ts";
import type { Database } from "../types/db.ts"

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

export const addSolvedProblems = async (problems: CF_Insert[]) => {
    const { error } = await supabase                                
                                .from("solved_problems")
                                .insert(problems);
    if(error)        
        throw new Error(`Error while inserting solved problems ${error.message}`);

    return { success: true };
}