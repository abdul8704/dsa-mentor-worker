import { getUserSolvedProblems } from "../repository/solvedProblems.repo.ts"
import type { CodeforcesResponse } from "../types/platformResponse.ts"
import type { Database } from "../types/db.ts"
import { getAllProbs, addProbs } from "../repository/problems.repo.ts"
import { difficultyMap } from "../utils/difficulty.ts"

type CF_Insert = Database["public"]["Tables"]["solved_problems"]["Insert"]
type ProblemEntry = Database["public"]["Tables"]["problems"]["Insert"]

const platformMap: Record<string, string> = {
    "codeforces": "CF"
}

export const filterNewSolved = async (user_id: string, platform: string, payload: CodeforcesResponse[]): Promise<CF_Insert[]> => {
    const solved: Set<string> = await getUserSolvedProblems(user_id);
    const problemSet: Set<string> = await getAllProbs();
    const solvedByDate: Set<string> = new Set<string>();
    let resultSet: CF_Insert[] = [];
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
