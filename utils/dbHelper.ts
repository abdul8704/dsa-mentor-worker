import { getUserSolvedProblems, getUserSolvedProblemsByDate } from "../repository/solvedProblems.repo.ts"
import type { AtcoderSubmissionResponse, CodeforcesResponse } from "../types/platformResponse.ts"
import type { Database } from "../types/db.ts"
import { getAllProbs, addProbs } from "../repository/problems.repo.ts"
import { difficultyMap } from "../utils/difficulty.ts"

type solved_problems_insert = Database["public"]["Tables"]["solved_problems"]["Insert"]
type ProblemEntry = Database["public"]["Tables"]["problems"]["Insert"]

const platformMap: Record<string, string> = {
    "codeforces": "CF",
    "atcoder": "ATC"
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

