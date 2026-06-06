import { supabase } from "../db/supabase.ts";
import { getAllUsers } from "../repository/profile.repo.ts";
import { getUserPlatforms } from "../repository/userPlatform.repo.ts";
import { upsertUserPlatformData } from "../repository/userPlatformData.repo.ts";
import { getLeetCodeDifficultyCounts } from "../services/leetcode/client.ts";

/**
 * Refreshes user_platform_data by aggregating easy/medium/hard counts
 * per user per platform.
 *
 * - LeetCode: fetches counts directly from LeetCode's GraphQL API.
 * - Codeforces/AtCoder: aggregates from local solved_problems + problems tables.
 *
 * Run: bun run scripts/refreshPlatformData.ts
 */

type DifficultyCounts = {
    easy: number;
    medium: number;
    hard: number;
    total: number;
};

/**
 * Fetches all unique solved problem IDs for a user on a platform,
 * then looks up each problem's difficulty and aggregates counts.
 *
 * Only counts problems where already_solved = false to avoid
 * double-counting re-solves on different dates.
 */
const getDifficultyCountsForUserPlatform = async (
    user_id: string,
    platform: string
): Promise<DifficultyCounts> => {
    // Step 1: Get all unique solved problem_ids for this user+platform
    // Use solved_problems with already_solved = false to get distinct problems
    const PAGE_SIZE = 1000;
    let allProblemIds: string[] = [];
    let from = 0;

    while (true) {
        const { data, error } = await supabase
            .from("solved_problems")
            .select("problem_id")
            .eq("user_id", user_id)
            .eq("platform", platform)
            .eq("already_solved", false)
            .range(from, from + PAGE_SIZE - 1);

        if (error) {
            throw new Error(
                `Error fetching solved problems for ${user_id}/${platform}: ${error.message}`
            );
        }

        if (!data || data.length === 0) break;

        allProblemIds.push(...data.map((row) => row.problem_id));

        if (data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
    }

    // Deduplicate problem IDs (in case any slipped through)
    const uniqueProblemIds = [...new Set(allProblemIds)];

    if (uniqueProblemIds.length === 0) {
        return { easy: 0, medium: 0, hard: 0, total: 0 };
    }

    // Step 2: Look up difficulties from the problems table
    // Supabase .in() has a limit, so batch in chunks of 500
    const BATCH_SIZE = 500;
    let easy = 0, medium = 0, hard = 0;

    for (let i = 0; i < uniqueProblemIds.length; i += BATCH_SIZE) {
        const batch = uniqueProblemIds.slice(i, i + BATCH_SIZE);

        const { data: problems, error: probError } = await supabase
            .from("problems")
            .select("problem_id, difficulty")
            .in("problem_id", batch);

        if (probError) {
            throw new Error(
                `Error fetching problem difficulties for ${user_id}/${platform}: ${probError.message}`
            );
        }

        if (problems) {
            for (const prob of problems) {
                const diff = prob.difficulty?.toLowerCase();
                if (diff === "easy") easy++;
                else if (diff === "medium") medium++;
                else if (diff === "hard") hard++;
            }
        }
    }

    return { easy, medium, hard, total: uniqueProblemIds.length };
};

/**
 * Fetches the current rating and max_rating for a user+platform
 * so we can preserve them during the upsert.
 */
const getExistingPlatformData = async (
    user_id: string,
    platform: string
): Promise<{ rating: number; max_rating: number }> => {
    const { data, error } = await supabase
        .from("user_platform_data")
        .select("rating, max_rating")
        .eq("user_id", user_id)
        .eq("platform", platform)
        .maybeSingle();

    if (error) {
        throw new Error(
            `Error fetching existing platform data for ${user_id}/${platform}: ${error.message}`
        );
    }

    return {
        rating: data?.rating ?? 0,
        max_rating: data?.max_rating ?? 0,
    };
};

/**
 * Refresh platform data for a single user across all their platforms.
 */
const refreshForUser = async (user_id: string): Promise<void> => {
    const platforms = await getUserPlatforms(user_id);

    for (const [platform, handle] of Object.entries(platforms)) {
        if (!handle) continue;

        try {
            // LeetCode: fetch counts directly from their API
            // Codeforces/AtCoder: aggregate from local DB
            const counts = platform === "leetcode"
                ? await getLeetCodeDifficultyCounts(handle)
                : await getDifficultyCountsForUserPlatform(user_id, platform);

            const existing = await getExistingPlatformData(user_id, platform);

            await upsertUserPlatformData({
                user_id,
                platform,
                solved_count: counts.total,
                easy: counts.easy,
                medium: counts.medium,
                hard: counts.hard,
                rating: existing.rating,
                max_rating: existing.max_rating,
                updated_at: new Date().toISOString(),
            });

            console.log(
                `  [${platform}] ${handle}: total=${counts.total} easy=${counts.easy} medium=${counts.medium} hard=${counts.hard}`
            );
        } catch (error) {
            if (error instanceof Error) {
                console.error(`  [${platform}] Failed for ${user_id}: ${error.message}`);
            } else {
                console.error(`  [${platform}] Failed for ${user_id}`);
            }
        }
    }
};

// --- Main ---
export const platformMain = async (user_id?: string) => {
    console.log("[RefreshPlatformData] Starting... for", user_id ? `user_id=${user_id}` : "ALL USERS");
    const users = user_id ? [user_id] : await getAllUsers();
    console.log(`[RefreshPlatformData] Found ${users.length} users.`);

    let processed = 0;
    let failed = 0;

    for (const user_id of users) {
        try {
            console.log(`[RefreshPlatformData] Processing user ${user_id}...`);
            await refreshForUser(user_id);
            processed++;
        } catch (error) {
            failed++;
            if (error instanceof Error) {
                console.error(`[RefreshPlatformData] Failed for ${user_id}: ${error.message}`);
            } else {
                console.error(`[RefreshPlatformData] Failed for ${user_id}`);
            }
        }
    }

    console.log(
        `[RefreshPlatformData] Done. processed=${processed} failed=${failed}`
    );
};

export const refreshForUserPlatform = async (user_id: string): Promise<void> => {
    await refreshForUser(user_id);
}
