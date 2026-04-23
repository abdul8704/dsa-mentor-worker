import { CODEFORCES_API  } from "../config.ts";
import type { CodeforcesResponse, CodeforcesSolvedCountResponse } from "../../types/platformResponse.ts";
import { filterNewSolvedCodeforces } from "../../utils/dbHelper.ts";
import type { Database } from "../../types/db.ts"
import { addSolvedProblems, getCodeforcesSolvedCount } from "../../repository/solvedProblems.repo.ts";
import { get } from "node:http";

type CF_Insert = Database["public"]["Tables"]["solved_problems"]["Insert"]

const getAcceptedUniqueSubmissions = (submissions: CodeforcesResponse[]): CodeforcesResponse[] => {
    const seenProblems = new Set<string>();

    return submissions.filter((submission) => {
        // filter accepted submission
        if (submission.verdict !== "OK") {
            return false;
        }

        const problemKey = `${submission.problem.contestId}-${submission.problem.index}-${new Date(submission.creationTimeSeconds * 1000).toISOString().split('T')[0]}`;

        // filter unique problems solved
        if (seenProblems.has(problemKey)) {
            return false;
        }

        seenProblems.add(problemKey);
        return true;
    });
}


export const getAllSubmissions = async (user_id: string, handle: string): Promise<void> => {
    const url = CODEFORCES_API.BASE_URL;
    let start = 1, count = 100;
    let allSubmissions: CodeforcesResponse[] = [];

    while (true) {
        const endpoint = url + CODEFORCES_API.endpoints.userStatus(handle, start, count);
        const response = await fetch(endpoint);

        if(response.status !== 200)
            throw new Error(`Failed to fetch submissions for ${handle}: ${response.statusText}`);

        const data = await response.json();

        if(data.status !== "OK")
            throw new Error(`API error for ${handle}: ${data.comment}`);

        allSubmissions = allSubmissions.concat(data.result as CodeforcesResponse[]);

        if(data.result.length < count) 
            break;

        start += count;
    }

    const acceptedUniqueSubmissions = getAcceptedUniqueSubmissions(allSubmissions);
    console.log(`Total unique Codeforces solved problems for ${handle}: ${acceptedUniqueSubmissions.length}`);

    const filtered: CF_Insert[] = await filterNewSolvedCodeforces(user_id, "codeforces", acceptedUniqueSubmissions);
    await addSolvedProblems(filtered); // add new solved problems to database
}

export const refreshCodeforces = async (user_id: string, handle: string): Promise<void> => {
    const url = CODEFORCES_API.BASE_URL;
    let start = 1, count = 50; // get only 50 submissions
    let submissions: CodeforcesResponse[] = [];
    console.log(`Refreshing Codeforces data for handle: ${handle}`);

    const endpoint = url + CODEFORCES_API.endpoints.userStatus(handle, start, count);
    const response = await fetch(endpoint); // fetch new submissions from codeforces api

    if(response.status !== 200)
        throw new Error(`Failed to fetch submissions for ${handle}: ${response.statusText}`);

    const data = await response.json();

    submissions = data.result as CodeforcesResponse[];

    const acceptedUniqueSubmissions = getAcceptedUniqueSubmissions(submissions);
    console.log(`Accepted unique submissions in latest refresh for ${handle}: ${acceptedUniqueSubmissions.length}`);

    // remove already solved problems and return only new ones
    const filtered: CF_Insert[] = await filterNewSolvedCodeforces(user_id, "codeforces", acceptedUniqueSubmissions);

    await addSolvedProblems(filtered); // add new solved problems to database
}

export const getCodeforcesUserInfo = async (user_id: string, handle: string): Promise<CodeforcesSolvedCountResponse> => {
    const url = CODEFORCES_API.BASE_URL + CODEFORCES_API.endpoints.userInfo(handle);
    const response = await fetch(url);      

    if(response.status !== 200)
        throw new Error(`Failed to fetch solved count for ${handle}: ${response.statusText}`);

    const data = await response.json();

    return {
        count: await getCodeforcesSolvedCount(user_id),
        rating: data.result[0].rating || 0,
        maxRating: data.result[0].maxRating || 0,
        rank: data.result[0].rank || "unrated"
    }
}
