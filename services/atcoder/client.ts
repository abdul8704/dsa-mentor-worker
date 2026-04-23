import type { AtcoderCountResponse, AtcoderSubmissionResponse, CodeforcesResponse } from "../../types/platformResponse.ts";
import { filterNewSolvedAtCoder } from "../../utils/dbHelper.ts";
import type { Database } from "../../types/db.ts"
import { ATCODER_API, CODEFORCES_API } from "../config.ts";
import { addSolvedProblems } from "../../repository/solvedProblems.repo.ts";

type AC_Insert = Database["public"]["Tables"]["solved_problems"]["Insert"]

const getAcceptedUniqueSubmissions = (submissions: AtcoderSubmissionResponse[]): AtcoderSubmissionResponse[] => {
    const seenProblems = new Set<string>();

    return submissions.filter((submission) => {
        // filter accepted submission

        if (submission.result !== "AC") {
            return false;
        }

        const problemKey = `${submission.problem_id}-${new Date(submission.epoch_second * 1000).toISOString().split('T')[0]}`;

        // filter unique problems solved
        if (seenProblems.has(problemKey)) {
            return false;
        }

        seenProblems.add(problemKey);
        return true;
    });
}

export const getAllSubmissionsAtcoder = async (user_id: string, handle: string): Promise<void> => {
    const url = ATCODER_API.BASE_URL;
    let startTime = 0;
    let allSubmissions: AtcoderSubmissionResponse[] = [];

    while (true) {
        const endpoint = url + ATCODER_API.endpoints.userSubmissions(handle, startTime);
        const response = await fetch(endpoint);

        if(response.status !== 200)
            throw new Error(`Failed to fetch submissions for ${handle}: ${response.statusText}`);

        const data = await response.json();
        if(!data)
            throw new Error(`API error for ${handle}: ${data}`);

        allSubmissions = allSubmissions.concat(data as AtcoderSubmissionResponse[]);

        if(data.length == 0  || data.length < 500) // if less than 500 submissions are returned, we have reached the end of the list
            break;

        const lastSubmission = data[data.length - 1];
        startTime = lastSubmission.epoch_second + 1; // set start time to last submission time + 1 second to avoid duplicates
    }
    const acceptedUniqueSubmissions = getAcceptedUniqueSubmissions(allSubmissions);
    console.log(`Total unique Atcoder solved problems for ${handle}: ${acceptedUniqueSubmissions.length}`);

    const filtered: AC_Insert[] = await filterNewSolvedAtCoder(user_id, "atcoder", acceptedUniqueSubmissions);
    await addSolvedProblems(filtered); // add new solved problems to database
}

export const refreshAtcoder = async (user_id: string, handle: string): Promise<void> => {
    const url = ATCODER_API.BASE_URL;
    let startTime = Math.floor(Date.now() / 1000) - 86400; // fetch submissions from the last 24 hours
    let allSubmissions: AtcoderSubmissionResponse[] = [];

    const endpoint = url + ATCODER_API.endpoints.userSubmissions(handle, startTime);
    const response = await fetch(endpoint);

    if(response.status !== 200)
        throw new Error(`Failed to fetch submissions for ${handle}: ${response.statusText}`);

    const data = await response.json();

    if(!data)
        throw new Error(`API error for ${handle}: ${data}`);

    allSubmissions = allSubmissions.concat(data.result as AtcoderSubmissionResponse[]);

    const acceptedUniqueSubmissions = getAcceptedUniqueSubmissions(allSubmissions);

    const filtered: AC_Insert[] = await filterNewSolvedAtCoder(user_id, "atcoder", acceptedUniqueSubmissions);
    await addSolvedProblems(filtered); // add new solved problems to database
}

export const getAtcoderSolvedCount = async (handle: string): Promise<AtcoderCountResponse> => {
    const url = ATCODER_API.BASE_URL + ATCODER_API.endpoints.acceptedCount(handle);
    const response = await fetch(url);

    if(response.status !== 200)
        throw new Error(`Failed to fetch solved count for ${handle}: ${response.statusText}`);

    const data: AtcoderCountResponse = await response.json();

    if(!data)
        throw new Error(`API error for ${handle}: ${data}`);

    const rating = await fetch(ATCODER_API.endpoints.rating(handle));
    const ratingData = await rating.json();

    const lastEntry = ratingData[ratingData.length - 1];
    const currentRating = lastEntry ? lastEntry.NewRating : 0;

    const maxRating = ratingData.reduce((max: number, entry: any) => Math.max(max, entry.NewRating), 0);

    return {
        count: data.count,
        rank: data.rank,
        rating: currentRating,
        maxRating: maxRating
    };
}