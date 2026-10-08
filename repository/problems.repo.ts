import { supabase } from "../db/supabase.ts";
import type { Database } from "../types/db.ts"
import type { GetProblemsResult } from "../types/platformResponse.ts";
import type { AddProblemsResult } from "../types/response.ts";

type ProblemEntry = Database["public"]["Tables"]["problems"]["Insert"]

// Paged: the problems catalog is shared across all users and platforms and is
// well past PostgREST's 1000-row default cap, so an unpaged select silently
// returned only part of it.
export const getAllProbs = async (): Promise<Set<string>> => {
    const PAGE_SIZE = 1000;
    const problemSet: Set<string> = new Set();
    let from = 0;

    while (true) {
        const { data, error } = await supabase
            .from("problems")
            .select("problem_id")
            .order("problem_id", { ascending: true })
            .range(from, from + PAGE_SIZE - 1);

        if (error)
            throw new Error(`Error while fetching problems ${error.message}`);

        data.forEach((problem) => problemSet.add(problem.problem_id));
        if (data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
    }

    return problemSet;
}

export const addProbs = async (probs: ProblemEntry[]): Promise<AddProblemsResult> => {
    if (probs.length === 0) {
        return { success: true, count: 0 };
    }

    const { error } = await supabase
        .from("problems")
        .upsert(probs, {
            onConflict: "problem_id",
            ignoreDuplicates: true,
        });

    if (error)
        throw new Error(`Error while adding new problems ${error.message}`);

    return { success: true, count: probs.length };
}

export const getLeetCodeProbsBySlug = async (
    slugs: string[]
): Promise<GetProblemsResult> => {
    if (slugs.length === 0) {
        return { found: {}, missing: [] };
    }

    const formattedIds = [...new Set(slugs)].map(slug => "LC" + slug);

    // Chunked: a full-history import can ask about thousands of slugs at once,
    // which would blow past both the URL length limit for .in() and the
    // 1000-row response cap.
    const CHUNK_SIZE = 200;
    const data: Database["public"]["Tables"]["problems"]["Row"][] = [];

    for (let i = 0; i < formattedIds.length; i += CHUNK_SIZE) {
        const { data: chunk, error } = await supabase
            .from("problems")
            .select("*")
            .in("problem_id", formattedIds.slice(i, i + CHUNK_SIZE));

        if (error) {
            throw new Error(`Error while fetching problem details ${error.message}`);
        }
        data.push(...chunk);
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