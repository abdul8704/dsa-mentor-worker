import * as cheerio from "cheerio";
import { CSES_API, CSES_TIMEZONE, CSES_MIN_REQUEST_INTERVAL_MS } from "./config.ts";
import { localWallTimeToUtcIso } from "../../utils/tzConvert.ts";
import { filterNewSolvedCSES } from "../../utils/dbHelper.ts";
import { buildCsesDifficultyIndex } from "../../utils/csesDifficulty.ts";
import { addSolvedProblems, getUserSolvedProblems } from "../../repository/solvedProblems.repo.ts";
import { upsertUserPlatformData } from "../../repository/userPlatformData.repo.ts";
// Same easy/medium/hard aggregation Codeforces/AtCoder rely on (problems.difficulty,
// set by utils/csesDifficulty.ts's section + solver-rank classifier) — reused
// here so the donut/platform-pill breakdown stays fresh on every 3-hour cron cycle,
// not just the one-off connect-time backfill (see routes/cses.ts).
import { getDifficultyCountsForUserPlatform } from "../../scripts/refreshPlatformData.ts";
import {
    getPlatformSecret,
    markPlatformSecretStatus,
} from "../../repository/userPlatformSecrets.repo.ts";
import type { CSESAccount, CSESSubmission, CSESTask, CSESTaskStatus } from "../../types/platformResponse.ts";
import type { Database } from "../../types/db.ts";
import type { PlatformSyncResult } from "../../types/response.ts";

type CSES_Insert = Database["public"]["Tables"]["solved_problems"]["Insert"];

/**
 * Thrown whenever a CSES fetch turns out not to be logged in — CSES returns
 * an ordinary 200 with its public logged-out page rather than a 401/403, so
 * every response has to be checked for the account marker, not just its
 * status code (see CSES_INTEGRATION_PLAN.md §5). Callers must never treat
 * this as "the mentee solved nothing."
 */
export class CSESAuthError extends Error {}

const ACCOUNT_MARKER = /<a class="account" href="\/user\/(\d+)">([^<]*)<\/a>/;

const parseAccount = (html: string): CSESAccount | null => {
    const match = ACCOUNT_MARKER.exec(html);
    if (!match || !match[1] || match[2] === undefined) return null;
    return { userId: Number(match[1]), username: match[2].trim() };
};

// ─── Global, cross-mentee rate limiting ────────────────────────────────────
// Every mentee's CSES traffic leaves from this one worker process/IP, so
// politeness has to be judged in aggregate, not per mentee — a per-call
// sleep alone would let two mentees' syncs interleave at 2x the intended
// rate. Every raw request chains onto this single promise queue.
let requestQueue: Promise<void> = Promise.resolve();

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const scheduleRequest = async (): Promise<void> => {
    const myTurn = requestQueue.then(() => sleep(CSES_MIN_REQUEST_INTERVAL_MS));
    requestQueue = myTurn;
    await myTurn;
};

const rawFetch = async (path: string, cookie: string, attempt = 0): Promise<string> => {
    await scheduleRequest();

    const response = await fetch(`${CSES_API.BASE_URL}${path}`, {
        headers: {
            Cookie: `PHPSESSID=${cookie}`,
            "User-Agent": "AlgoMentor/1.0 (+https://github.com/; mentee-linked CSES sync, low rate)",
        },
    });

    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
        await sleep(5_000 * 2 ** attempt);
        return rawFetch(path, cookie, attempt + 1);
    }
    if (!response.ok) {
        throw new Error(`CSES request failed (${response.status}) for ${path}`);
    }
    return response.text();
};

/** Fetches `path` and asserts the response is actually logged in — fails closed, never returns a page that just looks empty. */
const csesFetch = async (path: string, cookie: string, user_id: string): Promise<string> => {
    const html = await rawFetch(path, cookie);
    if (!parseAccount(html)) {
        await markPlatformSecretStatus(user_id, "cses", "needs_reauth");
        throw new CSESAuthError(
            `CSES session for user ${user_id} is no longer logged in (cookie expired or revoked)`
        );
    }
    return html;
};

/**
 * Stored shape for a "password" kind secret — see upsertPlatformSecret's
 * caller in routes/cses.ts. The mentee's password is kept (encrypted, same
 * as a cookie) specifically so scheduled refreshes never have to stop and
 * wait for a re-pasted cookie; see the re-login branch below.
 */
type StoredCsesPassword = { username: string; password: string };

const requireActiveSession = async (user_id: string): Promise<string> => {
    const secret = await getPlatformSecret(user_id, "cses");
    if (!secret) {
        throw new CSESAuthError(`No CSES credential stored for user ${user_id}`);
    }

    if (secret.kind === "password") {
        // Password-linked accounts re-authenticate fresh on every sync run
        // rather than reusing (and having to track the freshness of) a
        // cached cookie -- this is the whole point of offering password
        // storage: a scheduled refresh never has to stop and wait for the
        // mentee to re-paste an expired cookie. One extra login request per
        // sync run, not per page fetch within it (this is called once at
        // the top of getAllSubmissionsCSES/refreshCSES).
        let stored: StoredCsesPassword;
        try {
            stored = JSON.parse(secret.value) as StoredCsesPassword;
        } catch {
            throw new CSESAuthError(`Stored CSES credential for user ${user_id} is malformed`);
        }

        const { cookie } = await loginWithPassword(stored.username, stored.password);

        // Clear any stale needs_reauth from a previous cookie-based attempt
        // (e.g. a mentee who switched from cookie mode to password mode) --
        // a successful login here means the account is fine.
        if (secret.status !== "active") {
            await markPlatformSecretStatus(user_id, "cses", "active");
        }

        return cookie;
    }

    if (secret.status !== "active") {
        throw new CSESAuthError(`No active CSES session stored for user ${user_id}`);
    }
    return secret.value;
};

// ─── Parsing ────────────────────────────────────────────────────────────────

const TASK_HREF = /\/problemset\/task\/(\d+)/;
const RESULT_HREF = /\/problemset\/result\/(\d+)/;
const VIEW_PAGE_HREF = /\/problemset\/view\/\d+\/(\d+)/g;

const taskStatusFromScoreClass = (scoreClass: string): CSESTaskStatus => {
    if (scoreClass.includes("full")) return "solved";
    if (scoreClass.includes("zero")) return "attempted";
    return "untouched";
};

export const parseTaskList = (html: string): CSESTask[] => {
    const $ = cheerio.load(html);
    const tasks: CSESTask[] = [];

    $("h2").each((_, h2) => {
        const ul = $(h2).next("ul.task-list");
        const items = ul.find("li.task");
        if (!ul.length || !items.length) return; // e.g. the task-less "General" section

        const category = $(h2).text().trim();

        items.each((__, li) => {
            const anchor = $(li).find("a").first();
            const idMatch = TASK_HREF.exec(anchor.attr("href") ?? "");
            if (!idMatch || !idMatch[1]) return;

            const numbers = ($(li).find("span.detail").text().match(/\d+/g) ?? []).map(Number);
            const scoreClass = $(li).find("span.task-score").attr("class") ?? "";

            tasks.push({
                taskId: Number(idMatch[1]),
                name: anchor.text().trim(),
                category,
                solvedBy: numbers[0] ?? 0,
                attemptedBy: numbers[1] ?? 0,
                status: taskStatusFromScoreClass(scoreClass),
            });
        });
    });

    return tasks;
};

/** Parses one page of /problemset/view/{task}/ — returns every submission (not just accepted ones) plus the highest page number in the pager. */
export const parseSubmissions = (
    html: string,
    task: Pick<CSESTask, "taskId" | "name" | "category" | "solvedBy" | "attemptedBy">
): { submissions: CSESSubmission[]; pageCount: number } => {
    const $ = cheerio.load(html);
    const submissions: CSESSubmission[] = [];

    $("table.wide tr").each((_, row) => {
        const cells = $(row).find("td");
        if (cells.length < 6) return; // header row

        const resultLink = $(cells[5]).find("a").attr("href") ?? "";
        const resultMatch = RESULT_HREF.exec(resultLink);
        if (!resultMatch || !resultMatch[1]) return;

        submissions.push({
            submissionId: Number(resultMatch[1]),
            taskId: task.taskId,
            taskName: task.name,
            category: task.category,
            solvedBy: task.solvedBy,
            attemptedBy: task.attemptedBy,
            submittedAt: localWallTimeToUtcIso($(cells[0]).text(), CSES_TIMEZONE),
            language: $(cells[1]).text().trim(),
            accepted: ($(cells[4]).attr("class") ?? "").includes("full"),
        });
    });

    const pageNumbers = [...html.matchAll(VIEW_PAGE_HREF)]
        .map((m) => Number(m[1]))
        .filter((n) => !Number.isNaN(n));

    return { submissions, pageCount: pageNumbers.length ? Math.max(...pageNumbers) : 1 };
};

const fetchAcceptedSubmissions = async (
    task: CSESTask,
    cookie: string,
    user_id: string
): Promise<CSESSubmission[]> => {
    const accepted: CSESSubmission[] = [];
    let page = 1;

    while (true) {
        const html = await csesFetch(CSES_API.endpoints.taskView(task.taskId, page), cookie, user_id);
        const { submissions, pageCount } = parseSubmissions(html, task);
        accepted.push(...submissions.filter((s) => s.accepted));

        if (page >= pageCount) break;
        page++;
    }

    return accepted;
};

// ─── Platform-data + sync ───────────────────────────────────────────────────

/**
 * CSES has no numeric rating/contest system, so `rating`/`max_rating` are
 * always 0 here (same convention LeetCode's client already uses) — only
 * `solved_count` is meaningful. `easy`/`medium`/`hard` are filled in
 * separately by scripts/refreshPlatformData.ts, which already aggregates
 * them generically from `solved_problems` + `problems.difficulty` for any
 * non-LeetCode platform — no CSES-specific change needed there.
 */
const syncCsesPlatformData = async (user_id: string, tasks: CSESTask[]): Promise<void> => {
    const solvedCount = tasks.filter((t) => t.status === "solved").length;
    // Recomputed every call (not just at connect) so easy/medium/hard never go stale
    // as the mentee solves more CSES problems between backfills.
    const { easy, medium, hard } = await getDifficultyCountsForUserPlatform(user_id, "cses");

    await upsertUserPlatformData({
        user_id,
        platform: "cses",
        solved_count: solvedCount,
        easy,
        medium,
        hard,
        rating: 0,
        max_rating: 0,
        updated_at: new Date().toISOString(),
    });
};

/**
 * Full backfill: every task the mentee has ever solved, in one pass. Costs
 * one request for the list plus one (or more, if paginated) per solved
 * task — for a long-time CSES user this can be minutes, not seconds, at the
 * deliberately slow shared rate limit above. Intended to run once, at
 * onboarding (see routes/cses.ts), not on the regular fast-platform cron.
 */
export const getAllSubmissionsCSES = async (user_id: string, _handle: string): Promise<PlatformSyncResult> => {
    const cookie = await requireActiveSession(user_id);
    const tasks = parseTaskList(await csesFetch(CSES_API.endpoints.taskList(), cookie, user_id));

    const solvedTasks = tasks.filter((t) => t.status === "solved");
    const submissions: CSESSubmission[] = [];
    for (const task of solvedTasks) {
        submissions.push(...(await fetchAcceptedSubmissions(task, cookie, user_id)));
    }

    const filtered: CSES_Insert[] = await filterNewSolvedCSES(user_id, "cses", submissions, buildCsesDifficultyIndex(tasks));
    await addSolvedProblems(filtered);
    await syncCsesPlatformData(user_id, tasks);

    return { success: true, user_id, platform: "cses", newSubmissions: filtered.length };
};

/**
 * Incremental refresh: only fetches tasks that newly became solved since the
 * last sync (diffed against the mentee's existing solved set) — CSES has no
 * "recent activity" feed the way Codeforces/AtCoder do, so a status diff
 * against the task list is the only cheap way to find what's new. Tasks
 * that are merely "attempted" contribute no solved_problems rows either way
 * (AlgoMentor only tracks accepted solves), so they're never refetched.
 */
export const refreshCSES = async (user_id: string, _handle: string): Promise<PlatformSyncResult> => {
    const cookie = await requireActiveSession(user_id);
    const tasks = parseTaskList(await csesFetch(CSES_API.endpoints.taskList(), cookie, user_id));

    const alreadySolved = await getUserSolvedProblems(user_id); // all platforms; problem_ids are platform-prefixed
    const newlySolved = tasks.filter((t) => t.status === "solved" && !alreadySolved.has(`CSES${t.taskId}`));

    const submissions: CSESSubmission[] = [];
    for (const task of newlySolved) {
        submissions.push(...(await fetchAcceptedSubmissions(task, cookie, user_id)));
    }

    const filtered: CSES_Insert[] = await filterNewSolvedCSES(user_id, "cses", submissions, buildCsesDifficultyIndex(tasks));
    await addSolvedProblems(filtered);
    await syncCsesPlatformData(user_id, tasks);

    return { success: true, user_id, platform: "cses", newSubmissions: filtered.length };
};

/**
 * Verifies a raw CSES session cookie actually logs in, and returns the
 * account it belongs to. Used by routes/cses.ts at connect time — this is
 * CSES's equivalent of services/handleVerification.ts's cheap per-platform
 * checks, except it necessarily needs the credential itself, not just a
 * handle string, since CSES has nothing public to check a bare username
 * against.
 */
export const verifyCsesSession = async (cookie: string): Promise<CSESAccount> => {
    const html = await rawFetch(CSES_API.endpoints.taskList(), cookie);
    const account = parseAccount(html);
    if (!account) {
        throw new CSESAuthError("That CSES session cookie is not currently logged in");
    }
    return account;
};

// ─── Password-based login ───────────────────────────────────────────────────

const LOGIN_CSRF_RE = /name="csrf_token"\s+value="([^"]+)"/;
const USER_AGENT = "AlgoMentor/1.0 (+https://github.com/; mentee-linked CSES sync, low rate)";

/**
 * Reads every Set-Cookie header off a fetch Response. Node's undici exposes
 * `getSetCookie()` for this (a plain `.get("set-cookie")` collapses multiple
 * cookies into one unparsable string); fall back to the single combined
 * header on runtimes where it's missing, since CSES only ever sets one
 * cookie anyway.
 */
const getSetCookies = (response: Response): string[] => {
    const headers = response.headers as Headers & { getSetCookie?: () => string[] };
    if (typeof headers.getSetCookie === "function") {
        return headers.getSetCookie();
    }
    const combined = response.headers.get("set-cookie");
    return combined ? [combined] : [];
};

const extractSessionCookie = (setCookieHeaders: string[]): string | null => {
    for (const header of setCookieHeaders) {
        const match = /PHPSESSID=([^;]+)/.exec(header);
        if (match && match[1]) return match[1];
    }
    return null;
};

/**
 * Logs into CSES with a username + password and returns the resulting
 * session cookie + verified account — an alternative to pasting a session
 * cookie directly (routes/cses.ts accepts either). This is reasonable to
 * automate for CSES specifically because its login form is a plain
 * CSRF-protected POST with no CAPTCHA/bot-detection product behind it,
 * unlike e.g. LeetCode's (see LEETCODE_FULL_HISTORY_PLAN.md §3 for why
 * password login was recommended *against* there).
 *
 * The mentee's password is used exactly once, here, to obtain a session
 * cookie — it is never itself stored (only the resulting cookie is, via
 * upsertPlatformSecret, same as the cookie-paste path).
 */
export const loginWithPassword = async (
    username: string,
    password: string
): Promise<{ cookie: string; account: CSESAccount }> => {
    await scheduleRequest();
    const loginPageRes = await fetch(`${CSES_API.BASE_URL}${CSES_API.endpoints.loginPage()}`, {
        headers: { "User-Agent": USER_AGENT },
    });
    const loginPageHtml = await loginPageRes.text();

    const csrfMatch = LOGIN_CSRF_RE.exec(loginPageHtml);
    if (!csrfMatch || !csrfMatch[1]) {
        throw new CSESAuthError(
            "Could not read CSES's login form (csrf_token not found) — CSES's login page may have changed."
        );
    }
    const csrfToken = csrfMatch[1];

    const preLoginCookie = extractSessionCookie(getSetCookies(loginPageRes));
    if (!preLoginCookie) {
        throw new CSESAuthError("CSES did not issue a session cookie for the login page — cannot proceed.");
    }

    await scheduleRequest();
    const loginRes = await fetch(`${CSES_API.BASE_URL}${CSES_API.endpoints.login()}`, {
        method: "POST",
        // A successful login 302-redirects away from /login; a failed one
        // re-renders the login form with a 200. Following the redirect would
        // just cost an extra request for a page we don't need — read the
        // status directly instead.
        redirect: "manual",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Cookie: `PHPSESSID=${preLoginCookie}`,
            "User-Agent": USER_AGENT,
        },
        body: new URLSearchParams({ csrf_token: csrfToken, nick: username, pass: password }).toString(),
    });

    if (loginRes.status < 300 || loginRes.status >= 400) {
        throw new CSESAuthError("CSES rejected that username/password.");
    }

    // CSES reuses the same PHPSESSID across the login POST in practice, but
    // prefer a fresh one from the POST response if it issued one (e.g.
    // session-fixation protection regenerating the id on login).
    const postLoginCookie = extractSessionCookie(getSetCookies(loginRes)) ?? preLoginCookie;

    // Belt-and-braces on top of the redirect check above: confirm the
    // resulting session is actually authenticated before handing it back.
    const account = await verifyCsesSession(postLoginCookie).catch(() => null);
    if (!account) {
        throw new CSESAuthError("CSES rejected that username/password.");
    }

    return { cookie: postLoginCookie, account };
};
