import { LEETCODE_API  } from "../config.ts";
import type { LeetCodeContestHistory, LeetCodeUserProfileResponse, LeetCodeRecentSubmissionResponse } from "../../types/platformResponse.ts";
import { filterNewSolvedLeetcode } from "../../utils/dbHelper.ts";
import type { Database } from "../../types/db.ts"
import { addSolvedProblems, getCodeforcesSolvedCount } from "../../repository/solvedProblems.repo.ts";
import { upsertUserPlatformData } from "../../repository/userPlatformData.repo.ts";
import axios from "axios";
import type { ContestSyncResult, PlatformSyncResult } from "../../types/response.ts";
import { getUserContestIds, upsertUserContests, type UserContestInsert } from "../../repository/userContest.repo.ts";

type LC_Insert = Database["public"]["Tables"]["solved_problems"]["Insert"]

const slugifyContestTitle = (title: string): string =>
    title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

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

export type LeetCodeDifficultyCounts = {
    easy: number;
    medium: number;
    hard: number;
    total: number;
};

/**
 * Fetches per-difficulty solved counts directly from LeetCode's API.
 */
export const getLeetCodeDifficultyCounts = async (handle: string): Promise<LeetCodeDifficultyCounts> => {
    const { data } = await axios.post(LEETCODE_API.BASE_URL, LEETCODE_API.endpoints.userProfile(handle), {
        headers: {
            "Content-Type": "application/json"
        }
    });

    const stats = data.data.matchedUser.submitStats.acSubmissionNum as { difficulty: string; count: number }[];

    return {
        easy: stats.find((s) => s.difficulty === "Easy")?.count || 0,
        medium: stats.find((s) => s.difficulty === "Medium")?.count || 0,
        hard: stats.find((s) => s.difficulty === "Hard")?.count || 0,
        total: stats.find((s) => s.difficulty === "All")?.count || 0,
    };
};

const refreshLeetcodeUserInfo = async (user_id: string, handle: string) => {
    const counts = await getLeetCodeDifficultyCounts(handle);

    await upsertUserPlatformData({
        user_id,
        platform: "leetcode",
        solved_count: counts.total,
        easy: counts.easy,
        medium: counts.medium,
        hard: counts.hard,
        rating: 0,
        max_rating: 0,
        updated_at: new Date().toISOString()
    });
}


export const syncLeetCodePlatformData = async (user_id: string, handle: string): Promise<PlatformSyncResult> => {
    const { data } = await axios.post(LEETCODE_API.BASE_URL, LEETCODE_API.endpoints.recentSubmissions(handle), {
        headers: {
            "Content-Type": "application/json"
        }
    });

    const uniqueSubmissions = getAcceptedUniqueSubmissions(data.data.recentSubmissionList);
    const filteredSubmissions: LC_Insert[] = await filterNewSolvedLeetcode(user_id, "leetcode", uniqueSubmissions);
    await addSolvedProblems(filteredSubmissions); 
    await refreshLeetcodeUserInfo(user_id, handle);

    return { success: true, user_id, platform: "leetcode", newSubmissions: filteredSubmissions.length };
}

export const getProblemDetails = async (titleSlug: string[]) => {
    const detailsMap: Record<string, any> = {};

    for (const slug of titleSlug) {
        const { data } = await axios.post(LEETCODE_API.BASE_URL, LEETCODE_API.endpoints.questionBySlug(slug), {
            headers: {
                "Content-Type": "application/json"
            }
        });
        detailsMap[slug] = data.data.question;
    }
    
    return detailsMap;
}

export const refreshLeetCodeContests = async (user_id: string, handle: string): Promise<ContestSyncResult> => {
    const { data } = await axios.post(LEETCODE_API.BASE_URL, LEETCODE_API.endpoints.contestHistory(handle), {
        headers: {
            "Content-Type": "application/json",
        },
    });

    const history = data?.data?.userContestRankingHistory as LeetCodeContestHistory[] | undefined;

    if (!Array.isArray(history)) {
        throw new Error(`Invalid contest history response for ${handle}`);
    }

    const attended = history.filter((entry) => entry.attended);
    const existing = await getUserContestIds(user_id, "leetcode");
    const rows: UserContestInsert[] = attended.map((entry) => ({
        user_id,
        platform: "leetcode",
        contest_id: `LC-${slugifyContestTitle(entry.contest.title)}`,
        date: new Date(entry.contest.startTime * 1000).toISOString(),
        rank: Math.round(entry.ranking),
        rating: Math.round(entry.rating),
    }));

    const newCount = rows.filter((row) => !existing.has(row.contest_id)).length;
    await upsertUserContests(rows);

    console.log(`Synced ${rows.length} LeetCode contests for ${handle} (${newCount} new)`);

    return { success: true, user_id, platform: "leetcode", contestsSynced: newCount };
}

export type LeetCodeHeatmapResult = {
    heatmap: Map<string, number>;
    streak: number;
};

/**
 * Fetches LeetCode's submission calendar (heatmap) and current streak
 * via the official GraphQL API.
 */
export const getLeetCodeHeatmap = async (handle: string): Promise<LeetCodeHeatmapResult> => {
    const { data } = await axios.post(LEETCODE_API.BASE_URL, LEETCODE_API.endpoints.submissionCalendar(handle), {
        headers: {
            "Content-Type": "application/json",
        },
    });

    const userCalendar = data?.data?.matchedUser?.userCalendar;
    const calendarJson = userCalendar?.submissionCalendar;
    const streak: number = userCalendar?.streak ?? 0;

    if (!calendarJson || typeof calendarJson !== "string") {
        throw new Error(`Invalid submission calendar response for ${handle}`);
    }

    // submissionCalendar is a JSON string: { "unix_timestamp": count, ... }
    const parsed = JSON.parse(calendarJson) as Record<string, number>;
    const heatmap = new Map<string, number>();

    for (const [timestamp, count] of Object.entries(parsed)) {
        if (count <= 0) continue;
        const date = new Date(Number(timestamp) * 1000).toISOString().split("T")[0]!;
        // Sum in case multiple timestamps map to the same date
        heatmap.set(date, (heatmap.get(date) ?? 0) + count);
    }

    return { heatmap, streak };
}