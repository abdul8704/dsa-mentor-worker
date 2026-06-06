import { refreshCodeforces, getAllSubmissions } from "../services/codeforces/client.ts";
import { getUserPlatforms } from "../repository/userPlatform.repo.ts";
import { getAllUsers } from "../repository/profile.repo.ts";
import { getAllSubmissionsAtcoder, refreshAtcoder } from "../services/atcoder/client.ts";
import { syncLeetCodePlatformData } from "../services/leetcode/client.ts";
import { updateDailyCountForAllUsers } from "./dailyCount.ts";
import { updateStreakForAllUsers } from "./streak.ts";
import type { PlatformSyncResult } from "../types/response.ts";

const refreshMap: Record<string, (user_id: string, handle: string) => Promise<PlatformSyncResult>> = {
    codeforces: refreshCodeforces,
    atcoder: refreshAtcoder,
    leetcode: syncLeetCodePlatformData
};

const setUpUserMap: Record<string, (user_id: string, handle: string) => Promise<PlatformSyncResult>> = {
    codeforces: getAllSubmissions,
    atcoder: getAllSubmissionsAtcoder,
    leetcode: syncLeetCodePlatformData
}

export const setupUser = async (user_id: string): Promise<boolean> => {
    try {
        const userPlatforms: Record<string, string> = await getUserPlatforms(user_id);
        let allPlatformsSucceeded = true;

        for (const [platform, handle] of Object.entries(userPlatforms)) {
            const refresher = setUpUserMap[platform];

            if (!handle) {
                allPlatformsSucceeded = false;
                console.error(`No handle found for platform ${platform} and user ${user_id}`);
                continue;
            }

            if (!refresher) {
                allPlatformsSucceeded = false;
                console.error(`No refresher found for platform ${platform}`);
                continue;
            }

            try {
                await refresher(user_id, handle);
            } catch (error: unknown) {
                allPlatformsSucceeded = false;

                if (error instanceof Error) {
                    console.error(`Failed to refresh ${platform} for user ${user_id}: ${error.message}`);
                } else {
                    console.error(`Failed to refresh ${platform} for user ${user_id}`);
                }
            }
        }

        return allPlatformsSucceeded;
    } catch (error: unknown) {
        if (error instanceof Error) {
            console.error(`Failed to load platforms for user ${user_id}: ${error.message}`);
        } else {
            console.error(`Failed to load platforms for user ${user_id}`);
        }

        return false;
    }
}

export const refreshAll = async (): Promise<{ success: boolean }> => {
    const users: string[] = await getAllUsers();
    const results = await Promise.all(users.map((user_id) => refreshUser(user_id)));

    return { success: results.every(Boolean) };
}

export const refreshUser = async (user_id: string): Promise<boolean> => {
    try {
        const userPlatforms: Record<string, string> = await getUserPlatforms(user_id);
        let allPlatformsSucceeded = true;

        for (const [platform, handle] of Object.entries(userPlatforms)) {
            const refresher = refreshMap[platform];

            if (!handle) {
                allPlatformsSucceeded = false;
                console.error(`No handle found for platform ${platform} and user ${user_id}`);
                continue;
            }

            if (!refresher) {
                allPlatformsSucceeded = false;
                console.error(`No refresher found for platform ${platform}`);
                continue;
            }

            try {
                await refresher(user_id, handle);
            } catch (error: unknown) {
                allPlatformsSucceeded = false;

                if (error instanceof Error) {
                    console.error(`Failed to refresh ${platform} for user ${user_id}: ${error.message}`);
                } else {
                    console.error(`Failed to refresh ${platform} for user ${user_id}`);
                }
            }
        }

        return allPlatformsSucceeded;
    } catch (error: unknown) {
        if (error instanceof Error) {
            console.error(`Failed to load platforms for user ${user_id}: ${error.message}`);
        } else {
            console.error(`Failed to load platforms for user ${user_id}`);
        }

        return false;
    }
}
// Only run the pipeline when this file is executed directly (not imported)
const isMainModule = import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}`;

if (isMainModule) {
    // Pipeline: sync platforms → compute daily counts → compute streaks
    const result = await refreshAll();
    console.log(`[Refresh] completed: success=${result.success}`);

    console.log("[DailyCount] Starting daily count computation...");
    await updateDailyCountForAllUsers();
    console.log("[DailyCount] Done.");

    console.log("[Streak] Starting streak computation...");
    await updateStreakForAllUsers();
    console.log("[Streak] Done.");
}
