import { getUserSolvedProblems, getUserSolvedProblemsByDate } from "../repository/solvedProblems.repo.ts"
import type { AtcoderSubmissionResponse, CodeforcesResponse, GetProblemsResult, LeetCodeRecentSubmissionResponse } from "../types/platformResponse.ts"
import type { Database } from "../types/db.ts"
import { getAllProbs, addProbs, getLeetCodeProbsBySlug } from "../repository/problems.repo.ts"
import { difficultyMap } from "../utils/difficulty.ts"
import { getProblemDetails } from "../services/leetcode/client.ts"
import type { LeetCodeQuestion } from "../types/platformResponse.ts"

type solved_problems_insert = Database["public"]["Tables"]["solved_problems"]["Insert"]
type ProblemEntry = Database["public"]["Tables"]["problems"]["Insert"]

const platformMap: Record<string, string> = {
    "codeforces": "CF",
    "atcoder": "ATC",
    "leetcode": "LC"
}

export const filterNewSolvedCodeforces = async (user_id: string, platform: string, payload: CodeforcesResponse[]): Promise<solved_problems_insert[]> => {
    const solved: Set<string> = await getUserSolvedProblems(user_id);
    const solvedByDate: Set<string> = await getUserSolvedProblemsByDate(user_id);
    const problemSet: Set<string> = await getAllProbs();

    let resultSet: solved_problems_insert[] = [];
    let newProblems: ProblemEntry[] = [];
    const queuedProblemIds = new Set<string>();
    const platformPrefix = platformMap[platform];

    if (!platformPrefix) {
        return resultSet;
    }

    payload.sort((a, b) => a.creationTimeSeconds - b.creationTimeSeconds);

    payload.forEach((entry) => {
        const problem_id: string = platformPrefix + entry.problem.contestId + entry.problem.index;
        const solvedDate: string = problem_id + "-" + new Date(entry.creationTimeSeconds * 1000).toISOString().split('T')[0];

        if (solvedByDate.has(solvedDate)) {
            return;
        }
        solvedByDate.add(solvedDate);

        resultSet.push({
            user_id,
            platform,
            problem_id,
            solved_at: new Date(entry.creationTimeSeconds * 1000).toISOString(),
            already_solved: solved.has(problem_id) ? true : false
        });

        solved.add(problem_id); // Add to solved set to prevent duplicates in the same batch
    

        if(!problemSet.has(problem_id) && !queuedProblemIds.has(problem_id)){
            queuedProblemIds.add(problem_id);
            
            newProblems.push({
                problem_id,
                platform,
                rating: entry.problem.rating,
                tags: entry.problem.tags.map((tag) => tag.toLowerCase()),
                title: entry.problem.name,
                difficulty: difficultyMap(platform, entry.problem.rating)
            })
        }
    });

    await addProbs(newProblems);

    return resultSet;
}

export const filterNewSolvedAtCoder = async (user_id: string, platform: string, payload: AtcoderSubmissionResponse[]): Promise<solved_problems_insert[]> => {
    const solved: Set<string> = await getUserSolvedProblems(user_id);
    const solvedByDate: Set<string> = await getUserSolvedProblemsByDate(user_id);
    const problemSet: Set<string> = await getAllProbs();

    let resultSet: solved_problems_insert[] = [];
    let newProblems: ProblemEntry[] = [];
    const queuedProblemIds = new Set<string>();
    const platformPrefix = platformMap[platform];

    if (!platformPrefix) {
        return resultSet;
    }

    payload.forEach((entry) => {
        const problem_id: string = platformPrefix + entry.problem_id;
        const solvedDate: string = problem_id + "-" + new Date(entry.epoch_second * 1000).toISOString().split('T')[0];

        if (solvedByDate.has(solvedDate)) {
            return;
        }
        solvedByDate.add(solvedDate);

        resultSet.push({
            user_id,
            platform,
            problem_id,
            solved_at: new Date(entry.epoch_second * 1000).toISOString(),
            already_solved: solved.has(problem_id) ? true : false
        });

        solved.add(problem_id); // Add to solved set to prevent duplicates in the same batch
    

        if(!problemSet.has(problem_id) && !queuedProblemIds.has(problem_id)){
            queuedProblemIds.add(problem_id);
            
            newProblems.push({
                problem_id,
                platform,
                rating: entry.point,
                title: entry.problem_id,
                difficulty: difficultyMap(platform, entry.point)
            })
        }
    });

    await addProbs(newProblems);

    return resultSet;
}

export const filterNewSolvedLeetcode = async (user_id: string, platform: string, payload: LeetCodeRecentSubmissionResponse[]): Promise<solved_problems_insert[]> => {
    const solved: Set<string> = await getUserSolvedProblems(user_id);
    const solvedByDate: Set<string> = await getUserSolvedProblemsByDate(user_id);
    const problemSet: Set<string> = await getAllProbs();

    let resultSet: solved_problems_insert[] = [];
    let newProblems: ProblemEntry[] = [];
    const queuedProblemIds = new Set<string>();
    const platformPrefix = platformMap[platform];

    let problemSlugs: string[] = payload.map(entry => entry.titleSlug);
    const problemDetailsMap: GetProblemsResult = await getLeetCodeProbsBySlug(problemSlugs);

    if (problemDetailsMap.missing.length > 0) {
        const data: Record<string, LeetCodeQuestion> = await getProblemDetails(problemDetailsMap.missing);
        let newProbs: ProblemEntry[] = [];

        for (const slug of problemDetailsMap.missing) {
            const problem = data[slug];
            if (!problem) {
                continue;
            }
            newProbs.push({
                problem_id: platformPrefix + slug,
                platform,
                rating: null,
                tags: problem.topicTags.map((tag) => tag.slug.toLowerCase()),
                title: problem.title,
                difficulty: problem.difficulty.toLowerCase()
            });
        }
        await addProbs(newProbs);
        problemDetailsMap.missing.forEach((slug) => {
            if (data[slug]) {
                problemDetailsMap.found[slug] = data[slug];
            
            }
        });
    }

    if (!platformPrefix) {
        return resultSet;
    }

    payload.sort((a, b) => a.timestamp - b.timestamp);

    payload.forEach((entry) => {
        const problem_id: string = platformPrefix + entry.titleSlug;
        const solvedDate: string = problem_id + "-" + new Date(entry.timestamp * 1000).toISOString().split('T')[0];

        if (solvedByDate.has(solvedDate)) {
            return;
        }
        solvedByDate.add(solvedDate);

        resultSet.push({
            user_id,
            platform,
            problem_id,
            solved_at: new Date(entry.timestamp * 1000).toISOString(),
            already_solved: solved.has(problem_id) ? true : false
        });

        solved.add(problem_id); // Add to solved set to prevent duplicates in the same batch
    

        if(!problemSet.has(problem_id) && !queuedProblemIds.has(problem_id)){
            queuedProblemIds.add(problem_id);
            
            newProblems.push({
                problem_id,
                platform,
                rating: null,
                tags: problemDetailsMap.found?.[entry.titleSlug]?.topicTags?.map((tag) => tag.slug.toLowerCase()) ?? [],
                title: entry.title,
                difficulty: problemDetailsMap.found?.[entry.titleSlug]?.difficulty.toLowerCase() ?? "unknown"
            })
        }
    });

    await addProbs(newProblems);

    return resultSet;
}

