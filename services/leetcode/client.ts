import { LEETCODE_API  } from "../config.ts";
import type { LeetCodeUserProfileResponse, LeetCodeRecentSubmissionResponse } from "../../types/platformResponse.ts";
import { filterNewSolvedLeetcode } from "../../utils/dbHelper.ts";
import type { Database } from "../../types/db.ts"
import { addSolvedProblems, getCodeforcesSolvedCount } from "../../repository/solvedProblems.repo.ts";
import { upsertUserPlatformData } from "../../repository/userPlatformData.repo.ts";
import axios from "axios";

type LC_Insert = Database["public"]["Tables"]["solved_problems"]["Insert"]

const getAcceptedUniqueSubmissions = (submissions: LeetCodeRecentSubmissionResponse[]): LeetCodeRecentSubmissionResponse[] => {
    const seenProblems = new Set<string>();

    return submissions.filter((submission) => {
        // filter accepted submission
        if (submission.statusDisplay !== "Accepted") {
            return false;
        }

        const problemKey = `${submission.titleSlug}-${new Date(submission.timestamp * 1000).toISOString().split('T')[0]}`;
        // filter unique problems solved
        if (seenProblems.has(problemKey)) {
            return false;
        }

        seenProblems.add(problemKey);
        return true;
    });
}

const refreshLeetcodeUserInfo = async (user_id: string, handle: string) => {
    const { data } = await axios.post(LEETCODE_API.BASE_URL, {
        headers: {
            "content-type": "application/json"
        },
        body: JSON.stringify(LEETCODE_API.endpoints.userProfile(handle))
    });

    await upsertUserPlatformData({
        user_id,
        platform: "leetcode",
        solved_count: data.matchedUser.submitStats.acSubmissionNum.find((stat: any) => stat.difficulty === "All")?.count || 0,
        rating: null,
        max_rating: null,
        updated_at: new Date().toISOString()
    });
}


const syncLeetCodePlatformData = async (user_id: string, handle: string): Promise<void> => {
    const { data } = await axios.post(LEETCODE_API.BASE_URL, {
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(LEETCODE_API.endpoints.recentSubmissions(handle))
    });

    const uniqueSubmissions = getAcceptedUniqueSubmissions(data);
    const filteredSubmissions: LC_Insert[] = await filterNewSolvedLeetcode(user_id, "leetcode", uniqueSubmissions);
    await addSolvedProblems(filteredSubmissions); 
    await refreshLeetcodeUserInfo(user_id, handle);
} 

export const getProblemDetails = async (titleSlug: string[]) => {
    const detailsMap: Record<string, any> = {};

    for (const slug of titleSlug) {
        const { data } = await axios.post(LEETCODE_API.BASE_URL, {
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(LEETCODE_API.endpoints.questionBySlug(slug))
        });
        detailsMap[slug] = data;
    }
    
    return detailsMap;
}