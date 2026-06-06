import { refreshCodeforcesContests } from "../services/codeforces/client.ts";
import { refreshAtcoderContests } from "../services/atcoder/client.ts";
import { refreshLeetCodeContests } from "../services/leetcode/client.ts";
import { getUserPlatforms } from "../repository/userPlatform.repo.ts";
import { getAllUsers } from "../repository/profile.repo.ts";
import type { ContestRefreshAllResult, ContestSyncResult } from "../types/response.ts";

const contestRefreshMap: Record<string, (user_id: string, handle: string) => Promise<ContestSyncResult>> = {
    codeforces: refreshCodeforcesContests,
    atcoder: refreshAtcoderContests,
    leetcode: refreshLeetCodeContests,
};

export const refreshAllContests = async (): Promise<ContestRefreshAllResult> => {
    const users: string[] = await getAllUsers();
    let processed = 0;
    let failed = 0;

    for (const user_id of users) {
        const ok = await refreshUserContests(user_id);
        if (ok) {
            processed++;
        } else {
            failed++;
        }
    }

    return { success: failed === 0, processed, failed };
};

export const refreshUserContests = async (user_id: string): Promise<boolean> => {
    try {
        const userPlatforms: Record<string, string> = await getUserPlatforms(user_id);
        let allPlatformsSucceeded = true;

        for (const [platform, handle] of Object.entries(userPlatforms)) {
            const refresher = contestRefreshMap[platform];

            if (!handle) {
                allPlatformsSucceeded = false;
                console.error(`No handle found for platform ${platform} and user ${user_id}`);
                continue;
            }

            if (!refresher) {
                continue;
            }

            try {
                const result = await refresher(user_id, handle);
                console.log(
                    `[ContestRefresh] user=${user_id} platform=${result.platform} newContests=${result.contestsSynced}`
                );
            } catch (error: unknown) {
                allPlatformsSucceeded = false;

                if (error instanceof Error) {
                    console.error(`Failed to refresh contests for ${platform} user ${user_id}: ${error.message}`);
                } else {
                    console.error(`Failed to refresh contests for ${platform} user ${user_id}`);
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
};
// Only run when executed directly (not imported)
const isMainModule = import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}`;

if (isMainModule) {
    const result = await refreshAllContests();
    console.log(`[ContestRefresh] completed: success=${result.success} processed=${result.processed} failed=${result.failed}`);
}
