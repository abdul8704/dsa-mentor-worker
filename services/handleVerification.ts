import axios from "axios";
import { CODEFORCES_API, LEETCODE_API, ATCODER_API } from "./config.ts";

export interface HandleVerificationResult {
    platform: string;
    handle: string;
    valid: boolean;
    error?: string;
}

/**
 * Lightweight existence checks for each platform — a single cheap request
 * (no submission history, no pagination) so a typo'd handle can be caught
 * fast, well within the client's HTTP timeout. Actual data import (which is
 * slow) only ever runs for handles that pass this check.
 */

const verifyCodeforcesHandle = async (handle: string): Promise<boolean> => {
    const url = CODEFORCES_API.BASE_URL + CODEFORCES_API.endpoints.userInfo(handle);
    const response = await fetch(url);

    if (response.status !== 200) return false;

    const data = (await response.json()) as { status?: string; result?: unknown[] };
    return data.status === "OK" && Array.isArray(data.result) && data.result.length > 0;
};

const verifyLeetcodeHandle = async (handle: string): Promise<boolean> => {
    const { data } = await axios.post(LEETCODE_API.BASE_URL, LEETCODE_API.endpoints.userProfile(handle), {
        headers: { "Content-Type": "application/json" },
    });

    return Boolean(data?.data?.matchedUser);
};

const verifyAtcoderHandle = async (handle: string): Promise<boolean> => {
    const url = ATCODER_API.BASE_URL + ATCODER_API.endpoints.acceptedCount(handle);
    const response = await fetch(url);

    if (response.status !== 200) return false;

    const data = (await response.json()) as Partial<{ count: number; rank: number }>;
    return typeof data.count === "number" && typeof data.rank === "number";
};

const verifiers: Record<string, (handle: string) => Promise<boolean>> = {
    codeforces: verifyCodeforcesHandle,
    leetcode: verifyLeetcodeHandle,
    atcoder: verifyAtcoderHandle,
};

/** Verifies a single platform handle actually exists. Never throws. */
export const verifyHandle = async (platform: string, handle: string): Promise<HandleVerificationResult> => {
    const verifier = verifiers[platform];

    if (!verifier) {
        return { platform, handle, valid: false, error: `Unsupported platform: ${platform}` };
    }

    if (!handle || !handle.trim()) {
        return { platform, handle, valid: false, error: "Handle is empty" };
    }

    try {
        const valid = await verifier(handle.trim());
        return valid ? { platform, handle, valid } : { platform, handle, valid, error: "Handle not found" };
    } catch (error: unknown) {
        return {
            platform,
            handle,
            valid: false,
            error: error instanceof Error ? error.message : "Verification failed",
        };
    }
};

/** Verifies every platform handle in `platforms` in parallel. */
export const verifyHandles = async (platforms: Record<string, string>): Promise<HandleVerificationResult[]> => {
    return Promise.all(Object.entries(platforms).map(([platform, handle]) => verifyHandle(platform, handle)));
};
