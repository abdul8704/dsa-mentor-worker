import { supabase } from "../db/supabase.ts";
import type { Database } from "../types/db.ts"
import type { GetProblemsResult } from "../types/platformResponse.ts";

type ProblemEntry = Database["public"]["Tables"]["problems"]["Insert"]

export const getAllProbs = async (): Promise<Set<string>> => {
    const { data, error } = await supabase
        .from("problems")
        .select("problem_id");

    if (error)
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

    if (error)
        throw new Error(`Error while adding new problems ${error.message}`);
}

export const getLeetCodeProbsBySlug = async (
    slugs: string[]
): Promise<GetProblemsResult> => {
    if (slugs.length === 0) {
        return { found: {}, missing: [] };
    }

    const formattedIds = slugs.map(slug => "LC" + slug);

    const { data, error } = await supabase
        .from("problems")
        .select("*")
        .in("problem_id", formattedIds);

    if (error) {
        throw new Error(`Error while fetching problem details ${error.message}`);
    }

    const found: GetProblemsResult["found"] = {};

    // Track found slugs
    const foundSlugSet = new Set<string>();

    data.forEach((problem) => {
        // Remove "LC" prefix to get slug back
        const slug = problem.problem_id.replace(/^LC/, "");

        found[slug] = {
            ...problem,
            questionId: problem.problem_id,
            titleSlug: slug,
            topicTags: ((problem.tags ?? []).map(tag => ({ slug: tag })) as unknown) as [{ slug: string }],
            difficulty: problem.difficulty ?? "",
        };
        foundSlugSet.add(slug);
    });

    // Find missing slugs
    const missing = slugs.filter(slug => !foundSlugSet.has(slug));

    return { found, missing };
};