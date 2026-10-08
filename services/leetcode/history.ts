/**
 * Full LeetCode solve history via the user's own logged-in session.
 *
 * The public API (recentSubmissionList) only ever shows the ~20 most recent
 * submissions, so anything older never reaches solved_problems. With the
 * user's LEETCODE_SESSION + csrftoken cookies we can page through their
 * entire submission history instead. See LEETCODE_FULL_HISTORY_PLAN.md.
 *
 * Request pacing: every call goes through utils/httpClient.ts, which
 * serializes requests per host (leetcode.com: >=1s apart, with jitter) and
 * retries 403/429/5xx with backoff — shared by every user on this worker.
 *
 * This file deliberately does not import services/leetcode/client.ts (that
 * file imports this one for the session-aware cron sync).
 */
import { LEETCODE_API } from "../config.ts";
import { fetchJson } from "../../utils/httpClient.ts";
import type { LeetCodeRecentSubmissionResponse } from "../../types/platformResponse.ts";
import type { Database } from "../../types/db.ts";
import { addProbs, getLeetCodeProbsBySlug } from "../../repository/problems.repo.ts";
import {
    addSolvedProblems,
    getUserSolvedProblemsByDate,
    recomputeAlreadySolved,
} from "../../repository/solvedProblems.repo.ts";
import { filterNewSolvedLeetcode } from "../../utils/dbHelper.ts";

type ProblemEntry = Database["public"]["Tables"]["problems"]["Insert"];

/** The stored session is dead/invalid — the user must paste fresh keys. Never treat as "no submissions". */
export class LeetCodeAuthError extends Error {}

export type LeetCodeSession = { session: string; csrftoken: string };

const PAGE_SIZE = 20;
/** Safety cap: 2,500 pages = 50,000 submissions. */
const MAX_PAGES = 2_500;
/** Per-problem gap fill is capped so one odd account can't run for hours. */
const MAX_GAP_FILL_PROBLEMS = 300;
const CATALOG_PAGE_SIZE = 100;

// ─── Session parsing ─────────────────────────────────────────────────────────

const extractCookie = (raw: string, name: string): string | null => {
    const match = new RegExp(`(?:^|[;\\s])${name}=([^;\\s]+)`).exec(raw);
    return match?.[1] ?? null;
};

const cleanValue = (raw: string): string => raw.trim().replace(/^["']|["']$/g, "").replace(/;$/, "").trim();

/**
 * Accepts the two values as pasted from dev tools — bare values,
 * "NAME=value", or a whole Cookie header pasted into either box.
 */
export const normalizeLeetCodeSession = (rawSession: string, rawCsrf: string): LeetCodeSession | null => {
    const combined = `${rawSession}; ${rawCsrf}`;

    const session =
        extractCookie(combined, "LEETCODE_SESSION") ??
        (rawSession.includes("=") ? null : cleanValue(rawSession));
    const csrftoken =
        extractCookie(combined, "csrftoken") ??
        (rawCsrf.includes("=") ? null : cleanValue(rawCsrf));

    if (!session || !csrftoken) return null;
    return { session: cleanValue(session), csrftoken: cleanValue(csrftoken) };
};

// ─── GraphQL transport ───────────────────────────────────────────────────────

type GqlResponse<T> = { data?: T | null; errors?: { message: string }[] };

const lcGraphql = async <T>(
    s: LeetCodeSession | null,
    payload: { query: string; variables?: unknown },
    label: string
): Promise<GqlResponse<T>> => {
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
        Referer: "https://leetcode.com/",
        Origin: "https://leetcode.com",
    };
    if (s) {
        headers["x-csrftoken"] = s.csrftoken;
        headers["Cookie"] = `LEETCODE_SESSION=${s.session}; csrftoken=${s.csrftoken}`;
    }

    try {
        return await fetchJson<GqlResponse<T>>(LEETCODE_API.BASE_URL, {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
            label,
            timeoutMs: 20_000,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        if (s && /\b(401|403)\b/.test(message)) {
            throw new LeetCodeAuthError(
                "LeetCode rejected these session keys. Copy fresh LEETCODE_SESSION and csrftoken values and try again."
            );
        }
        throw error;
    }
};

const looksLikeAuthError = (errors: { message: string }[] | undefined): boolean =>
    (errors ?? []).some((e) => /auth|login|sign ?in|permission|credential/i.test(e.message));

// ─── Session check ───────────────────────────────────────────────────────────

/** Returns the LeetCode username the session belongs to, or throws LeetCodeAuthError. */
export const verifyLeetCodeSession = async (s: LeetCodeSession): Promise<string> => {
    const res = await lcGraphql<{ userStatus: { isSignedIn: boolean; username: string } | null }>(
        s,
        LEETCODE_API.endpoints.userStatus(),
        "LC userStatus"
    );
    const status = res.data?.userStatus;
    if (!status?.isSignedIn || !status.username) {
        throw new LeetCodeAuthError("Those LeetCode session keys are not signed in (expired or copied incorrectly).");
    }
    return status.username;
};

// ─── Submission walking ──────────────────────────────────────────────────────

type RawSubmission = {
    id: string;
    title: string;
    titleSlug: string;
    timestamp: string | number;
    statusDisplay: string;
    lang: string;
};

type SubmissionPage = {
    lastKey: string | null;
    hasNext: boolean;
    submissions: RawSubmission[];
};

const dateKey = (timestampSeconds: number): string => new Date(timestampSeconds * 1000).toISOString().split("T")[0]!;

export type WalkResult = {
    accepted: LeetCodeRecentSubmissionResponse[];
    pages: number;
    /** True when we reached the user's very first submission. */
    reachedEnd: boolean;
};

/**
 * Pages through the signed-in user's submissions, newest first, keeping only
 * accepted ones.
 *
 * stopAtKnown: "LC<slug>-<YYYY-MM-DD>" keys already in solved_problems. When
 * given, stops after the first page containing a known accepted solve —
 * everything older is already stored (used by the regular cron refresh).
 */
export const walkAcceptedSubmissions = async (
    s: LeetCodeSession,
    options: {
        questionSlug?: string;
        stopAtKnown?: Set<string>;
        maxPages?: number;
        onPage?: (pagesSoFar: number, acceptedSoFar: number) => void;
    } = {}
): Promise<WalkResult> => {
    const accepted: LeetCodeRecentSubmissionResponse[] = [];
    const maxPages = options.maxPages ?? MAX_PAGES;
    let lastKey: string | null = null;
    let pages = 0;
    let reachedEnd = false;

    while (pages < maxPages) {
        const res: GqlResponse<{ submissionList: SubmissionPage | null }> = await lcGraphql(
            s,
            LEETCODE_API.endpoints.submissionList(pages * PAGE_SIZE, PAGE_SIZE, lastKey, options.questionSlug ?? null),
            `LC submissionList page ${pages + 1}${options.questionSlug ? ` (${options.questionSlug})` : ""}`
        );

        const list = res.data?.submissionList;
        if (!list) {
            const detail = res.errors?.map((e) => e.message).join("; ") || "empty response";
            if (looksLikeAuthError(res.errors) || !res.errors?.length) {
                throw new LeetCodeAuthError(`LeetCode didn't return your submissions (${detail}). The session has probably expired.`);
            }
            throw new Error(`LeetCode submissionList failed: ${detail}`);
        }

        pages++;
        let hitKnown = false;

        for (const sub of list.submissions) {
            if (sub.statusDisplay !== "Accepted") continue;
            const timestamp = Number(sub.timestamp);
            if (!Number.isFinite(timestamp)) continue;

            accepted.push({
                id: String(sub.id),
                title: sub.title,
                titleSlug: sub.titleSlug,
                timestamp,
                statusDisplay: sub.statusDisplay,
                lang: sub.lang,
            });

            if (options.stopAtKnown?.has(`LC${sub.titleSlug}-${dateKey(timestamp)}`)) {
                hitKnown = true;
            }
        }

        options.onPage?.(pages, accepted.length);

        if (!list.hasNext) {
            reachedEnd = true;
            break;
        }
        if (hitKnown) break;
        if (list.submissions.length === 0) break; // defensive: no progress possible
        lastKey = list.lastKey;
    }

    return { accepted, pages, reachedEnd };
};

/** Every problem the signed-in user has solved (slugs), via the problem list's AC filter. */
const listSolvedSlugs = async (s: LeetCodeSession): Promise<Set<string>> => {
    const solved = new Set<string>();
    let skip = 0;
    let total = Infinity;

    while (skip < total) {
        const res = await lcGraphql<{
            problemsetQuestionList: { total: number; questions: { titleSlug: string; status: string | null }[] } | null;
        }>(s, LEETCODE_API.endpoints.problemsetQuestionList(skip, CATALOG_PAGE_SIZE, { status: "AC" }), `LC solved list skip=${skip}`);

        const page = res.data?.problemsetQuestionList;
        if (!page) {
            throw new Error(`LeetCode solved-problem list failed: ${res.errors?.map((e) => e.message).join("; ") ?? "empty"}`);
        }

        total = page.total;
        for (const q of page.questions) solved.add(q.titleSlug);
        if (page.questions.length === 0) break;
        skip += CATALOG_PAGE_SIZE;
    }

    return solved;
};

// ─── Problem metadata ────────────────────────────────────────────────────────

/**
 * Makes sure every slug has a row in `problems` (title, difficulty, tags)
 * before solved rows are written, so filterNewSolvedLeetcode doesn't fall
 * back to its one-request-per-slug lookup for hundreds of problems.
 *
 * Many missing → page the public catalog (~35 requests for all of LeetCode).
 * A few missing → one throttled request each.
 */
const ensureProblemMetadata = async (s: LeetCodeSession, slugs: string[]): Promise<void> => {
    let { missing } = await getLeetCodeProbsBySlug(slugs);
    if (missing.length === 0) return;

    const toEntry = (q: { title: string; titleSlug: string; difficulty: string; topicTags: { slug: string }[] | null }): ProblemEntry => ({
        problem_id: "LC" + q.titleSlug,
        platform: "leetcode",
        rating: null,
        title: q.title,
        difficulty: (q.difficulty ?? "unknown").toLowerCase(),
        tags: (q.topicTags ?? []).map((t) => t.slug.toLowerCase()),
    });

    if (missing.length > 40) {
        const wanted = new Set(missing);
        const found: ProblemEntry[] = [];
        let skip = 0;
        let total = Infinity;

        while (skip < total && wanted.size > 0) {
            const res = await lcGraphql<{
                problemsetQuestionList: {
                    total: number;
                    questions: { title: string; titleSlug: string; difficulty: string; topicTags: { slug: string }[] | null }[];
                } | null;
            }>(null, LEETCODE_API.endpoints.problemsetQuestionList(skip, CATALOG_PAGE_SIZE), `LC catalog skip=${skip}`);

            const page = res.data?.problemsetQuestionList;
            if (!page || page.questions.length === 0) break;
            total = page.total;

            for (const q of page.questions) {
                if (wanted.delete(q.titleSlug)) found.push(toEntry(q));
            }
            skip += CATALOG_PAGE_SIZE;
        }

        await addProbs(found);
        missing = [...wanted];
    }

    const individually: ProblemEntry[] = [];
    for (const slug of missing) {
        const res = await lcGraphql<{
            question: { title: string; titleSlug: string; difficulty: string; topicTags: { slug: string }[] | null } | null;
        }>(null, LEETCODE_API.endpoints.questionBySlug(slug), `LC question ${slug}`);
        // null = deleted/hidden problem; filterNewSolvedLeetcode stores it
        // with the submission's title and difficulty "unknown".
        if (res.data?.question) individually.push(toEntry(res.data.question));
    }
    await addProbs(individually);
};

// ─── Import + incremental sync ───────────────────────────────────────────────

export type ImportProgress = {
    phase: string;
    pages: number;
    acceptedSeen: number;
};

export type ImportSummary = {
    pages: number;
    acceptedSubmissions: number;
    distinctProblems: number;
    targetProblems: number | null;
    gapFilled: number;
    insertedRows: number;
    correctedFlags: number;
    reachedEnd: boolean;
};

/**
 * Imports the user's whole accepted history into solved_problems.
 *
 * Duplicate safety: rows are built by filterNewSolvedLeetcode, which skips
 * every (problem, day) already stored for this user (one row per problem per
 * day — re-solves on later days are kept, flagged already_solved), and the
 * insert itself ignores duplicates once db/solved_problems_unique.sql is
 * applied. Running this again only adds what's missing.
 */
export const importLeetCodeHistory = async (
    user_id: string,
    s: LeetCodeSession,
    targetProblems: number | null,
    onProgress: (p: ImportProgress) => void = () => {}
): Promise<ImportSummary> => {
    onProgress({ phase: "Reading submission history", pages: 0, acceptedSeen: 0 });

    const walk = await walkAcceptedSubmissions(s, {
        onPage: (pages, acceptedSeen) => onProgress({ phase: "Reading submission history", pages, acceptedSeen }),
    });

    const accepted = [...walk.accepted];
    const slugs = new Set(accepted.map((a) => a.titleSlug));
    let gapFilled = 0;

    // Completeness: if fewer distinct problems than LeetCode's own solved
    // count, look up the missing ones one by one.
    if (targetProblems !== null && slugs.size < targetProblems) {
        onProgress({ phase: "Checking for missed problems", pages: walk.pages, acceptedSeen: accepted.length });
        try {
            const solvedSlugs = await listSolvedSlugs(s);
            const missing = [...solvedSlugs].filter((slug) => !slugs.has(slug)).slice(0, MAX_GAP_FILL_PROBLEMS);

            for (const slug of missing) {
                try {
                    const perProblem = await walkAcceptedSubmissions(s, { questionSlug: slug, maxPages: 10 });
                    if (perProblem.accepted.length > 0) {
                        accepted.push(...perProblem.accepted);
                        slugs.add(slug);
                        gapFilled++;
                    }
                } catch (error: unknown) {
                    if (error instanceof LeetCodeAuthError) throw error;
                    console.warn(`[LeetCodeImport] gap fill skipped ${slug}: ${error instanceof Error ? error.message : error}`);
                }
            }
        } catch (error: unknown) {
            if (error instanceof LeetCodeAuthError) throw error;
            console.warn(`[LeetCodeImport] gap fill unavailable: ${error instanceof Error ? error.message : error}`);
        }
    }

    onProgress({ phase: "Fetching problem details", pages: walk.pages, acceptedSeen: accepted.length });
    await ensureProblemMetadata(s, [...slugs]);

    onProgress({ phase: "Saving solved problems", pages: walk.pages, acceptedSeen: accepted.length });
    const rows = await filterNewSolvedLeetcode(user_id, "leetcode", accepted);
    await addSolvedProblems(rows);

    // Old first-solves were just inserted after newer rows that had been
    // flagged as "first" — fix the flags so nothing is double counted.
    const correctedFlags = await recomputeAlreadySolved(user_id, "leetcode");

    return {
        pages: walk.pages,
        acceptedSubmissions: accepted.length,
        distinctProblems: slugs.size,
        targetProblems,
        gapFilled,
        insertedRows: rows.length,
        correctedFlags,
        reachedEnd: walk.reachedEnd,
    };
};

/**
 * Cron-time refresh with a stored session: walk newest-first and stop at the
 * first already-stored solve (usually one request). Removes the public API's
 * ~20-submission ceiling between refreshes. Returns rows inserted.
 */
export const syncLeetCodeWithSession = async (user_id: string, s: LeetCodeSession): Promise<number> => {
    const known = await getUserSolvedProblemsByDate(user_id);
    const walk = await walkAcceptedSubmissions(s, { stopAtKnown: known, maxPages: 50 });
    if (walk.accepted.length === 0) return 0;

    await ensureProblemMetadata(s, [...new Set(walk.accepted.map((a) => a.titleSlug))]);
    const rows = await filterNewSolvedLeetcode(user_id, "leetcode", walk.accepted);
    await addSolvedProblems(rows);
    return rows.length;
};

// ─── Import job state (in-memory) ────────────────────────────────────────────
// Lives here (not in jobs/) so client.ts can check it without an import cycle.
// Resets if the worker restarts; a restarted import simply runs again and,
// being idempotent, only adds what's missing.

export type LeetCodeImportState = {
    state: "running" | "done" | "failed";
    phase: string;
    pages: number;
    acceptedSeen: number;
    summary: ImportSummary | null;
    error: string | null;
    startedAt: string;
    finishedAt: string | null;
};

const importStates = new Map<string, LeetCodeImportState>();

export const getLeetCodeImportState = (user_id: string): LeetCodeImportState | null => importStates.get(user_id) ?? null;

export const isLeetCodeImportRunning = (user_id: string): boolean => importStates.get(user_id)?.state === "running";

export const setLeetCodeImportState = (user_id: string, state: LeetCodeImportState): void => {
    importStates.set(user_id, state);
};
