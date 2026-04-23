import { refreshCodeforces, getAllSubmissions } from "../services/codeforces/client.ts";
import { getUserPlatforms } from "../repository/userPlatform.repo.ts";
import { getAllUsers } from "../repository/profile.repo.ts";
import { getAllSubmissionsAtcoder, refreshAtcoder } from "../services/atcoder/client.ts";

const refreshMap: Record<string, (user_id: string, handle: string) => Promise<void>> = {
    codeforces: refreshCodeforces,
    atcoder: refreshAtcoder
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

await refreshAll();
