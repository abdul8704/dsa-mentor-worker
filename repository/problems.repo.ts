import { supabase } from "../db/supabase.ts";
import type { Database } from "../types/db.ts"

type ProblemEntry = Database["public"]["Tables"]["problems"]["Insert"]

export const getAllProbs = async (): Promise<Set<string>> => {
    const { data, error } = await supabase
                                .from("problems")
                                .select("problem_id");

    if(error)
        throw new Error(`Error while fetching problems ${error.message}`);

    let problemSet: Set<string> = new Set();

    data.forEach((problem) => problemSet.add(problem.problem_id));

    return problemSet;
}

export const addProbs = async (probs: ProblemEntry[]): Promise<void> => {
    if (probs.length === 0) {
        return;
    }

    const { error } = await supabase
                                    .from("problems")
                                    .upsert(probs, {
                                        onConflict: "problem_id",
                                        ignoreDuplicates: true,
                                    });

    if(error)
            throw new Error(`Error while adding new problems ${error.message}`);
}