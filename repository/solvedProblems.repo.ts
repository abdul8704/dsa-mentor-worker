import { supabase } from "../db/supabase.ts";
import type { Database } from "../types/db.ts"
import type { CodeforcesSolvedCountResponse } from "../types/platformResponse.ts";
import type { AddSolvedProblemsResult } from "../types/response.ts";

type CF_Insert = Database["public"]["Tables"]["solved_problems"]["Insert"]

const PAGE_SIZE = 1000;

/**
 * Every (problem_id, solved_date) row for a user, paged.
 *
 * Supabase/PostgREST caps an unpaged select at 1000 rows. The old unpaged
 * versions of the two helpers below therefore silently returned a truncated
 * set for anyone with >1000 solved rows — and since those sets are what every
 * filterNewSolved* function dedupes against, a truncated set meant duplicate
 * solved_problems rows on the next sync. A full LeetCode history import puts
 * most active users over that line, so this has to be complete.
 */
const getAllSolvedRowsForUser = async (
    user_id: string
): Promise<{ problem_id: string; solved_date: string }[]> => {
    const rows: { problem_id: string; solved_date: string }[] = [];
    let from = 0;

    while (true) {
        const { data, error } = await supabase
            .from("solved_problems")
            .select("problem_id, solved_date")
            .eq("user_id", user_id)
            .order("solved_at", { ascending: true })
            .order("problem_id", { ascending: true }) // tie-breaker so paging is stable
            .range(from, from + PAGE_SIZE - 1);

        if (error)
            throw new Error(`Error while fetching users solved problems ${error.message}`);

        rows.push(...data);
        if (data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
    }

    return rows;
};

/** (platform, solved_date) for every solved row of a user, optionally from a date on. Paged. */
export const getSolvedDatesForUser = async (
    user_id: string,
    fromDate?: string
): Promise<{ platform: string; solved_date: string }[]> => {
    const rows: { platform: string; solved_date: string }[] = [];
    let from = 0;

    while (true) {
        let query = supabase
            .from("solved_problems")
            .select("platform, solved_date")
            .eq("user_id", user_id);
        if (fromDate) query = query.gte("solved_date", fromDate);

        const { data, error } = await query
            .order("solved_date", { ascending: true })
            .order("problem_id", { ascending: true })
            .range(from, from + PAGE_SIZE - 1);

        if (error)
            throw new Error(`Error while fetching solved dates for ${user_id}: ${error.message}`);

        rows.push(...data);
        if (data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
    }

    return rows;
};

export const getUserSolvedProblems = async (userid: string): Promise<Set<string>> => {
    const rows = await getAllSolvedRowsForUser(userid);
    return new Set(rows.map((row) => row.problem_id));
}

export const getUserSolvedProblemsByDate = async (userid: string): Promise<Set<string>> => {
    const rows = await getAllSolvedRowsForUser(userid);
    return new Set(rows.map((row) => row.problem_id + "-" + row.solved_date));
}

export const deleteSolvedProblemsForPlatform = async (user_id: string, platform: string): Promise<void> => {
    const { error } = await supabase
        .from("solved_problems")
        .delete()
        .eq("user_id", user_id)
        .eq("platform", platform);

    if (error)
        throw new Error(`Error while deleting solved problems for ${user_id}/${platform}: ${error.message}`);
}

const INSERT_CHUNK_SIZE = 500;

/**
 * Inserts solved rows, never creating a second row for the same
 * (user_id, problem_id, solved_date).
 *
 * Callers already dedupe against the user's existing rows in code
 * (filterNewSolved*). This is the second guard for races (e.g. the cron
 * refresh and a LeetCode history import running for the same user at once):
 * once db/solved_problems_unique.sql has been applied, the upsert below
 * silently skips duplicates at the database level. Until then Postgres has no
 * matching unique index, rejects ON CONFLICT, and we fall back to a plain
 * insert (the in-code dedupe still applies).
 */
export const addSolvedProblems = async (problems: CF_Insert[]): Promise<AddSolvedProblemsResult> => {
    if (problems.length === 0) {
        return { success: true, insertedCount: 0 };
    }

    for (let i = 0; i < problems.length; i += INSERT_CHUNK_SIZE) {
        const chunk = problems.slice(i, i + INSERT_CHUNK_SIZE);

        const { error } = await supabase
            .from("solved_problems")
            .upsert(chunk, { onConflict: "user_id,problem_id,solved_date", ignoreDuplicates: true });

        if (!error) continue;

        const noMatchingConstraint = error.code === "42P10" || /no unique or exclusion constraint/i.test(error.message);
        if (!noMatchingConstraint)
            throw new Error(`Error while inserting solved problems ${error.message}`);

        const { error: insertError } = await supabase.from("solved_problems").insert(chunk);
        if (insertError)
            throw new Error(`Error while inserting solved problems ${insertError.message}`);
    }

    return { success: true, insertedCount: problems.length };
}

/**
 * Re-derives `already_solved` for one user+platform from scratch: the earliest
 * row per problem is the first solve (false), every later row is a re-solve
 * (true). daily_count, streaks and difficulty totals all count "new solves" as
 * already_solved = false, so this must be correct.
 *
 * Needed whenever rows can arrive out of chronological order — most notably a
 * LeetCode history import, which inserts years-old first solves *after* the
 * regular sync already flagged recent re-solves of the same problems as
 * "first". Returns how many rows were corrected.
 */
export const recomputeAlreadySolved = async (user_id: string, platform: string): Promise<number> => {
    const rows: { problem_id: string; solved_date: string; already_solved: boolean }[] = [];
    let from = 0;

    while (true) {
        const { data, error } = await supabase
            .from("solved_problems")
            .select("problem_id, solved_date, already_solved")
            .eq("user_id", user_id)
            .eq("platform", platform)
            .order("solved_at", { ascending: true })
            .order("problem_id", { ascending: true }) // tie-breaker so paging is stable
            .range(from, from + PAGE_SIZE - 1);

        if (error)
            throw new Error(`Error while reading solved problems for ${user_id}/${platform}: ${error.message}`);

        rows.push(...data);
        if (data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
    }

    const seen = new Set<string>();
    const toFlip: { problem_id: string; solved_date: string; already_solved: boolean }[] = [];

    for (const row of rows) {
        const shouldBe = seen.has(row.problem_id);
        seen.add(row.problem_id);
        if (row.already_solved !== shouldBe) {
            toFlip.push({ ...row, already_solved: shouldBe });
        }
    }

    for (const row of toFlip) {
        const { error } = await supabase
            .from("solved_problems")
            .update({ already_solved: row.already_solved })
            .eq("user_id", user_id)
            .eq("platform", platform)
            .eq("problem_id", row.problem_id)
            .eq("solved_date", row.solved_date);

        if (error)
            throw new Error(`Error while fixing already_solved for ${user_id}/${row.problem_id}: ${error.message}`);
    }

    return toFlip.length;
}

export const getSolvedCountsByDateInRange = async (
    user_id: string,
    fromDate: string,
    toDate: string
): Promise<Map<string, number>> => {
    const counts = new Map<string, number>();
    const pageSize = 1000;
    let offset = 0;

    while (true) {
        const { data, error } = await supabase
            .from("solved_problems")
            .select("solved_date")
            .eq("user_id", user_id)
            .gte("solved_date", fromDate)
            .lte("solved_date", toDate)
            .range(offset, offset + pageSize - 1);

        if (error) {
            throw new Error(`Error fetching solved problems for heatmap: ${error.message}`);
        }

        if (!data.length) {
            break;
        }

        for (const row of data) {
            if (!row.solved_date) {
                continue;
            }
            counts.set(row.solved_date, (counts.get(row.solved_date) ?? 0) + 1);
        }

        if (data.length < pageSize) {
            break;
        }

        offset += pageSize;
    }

    return counts;
};

export const getCodeforcesSolvedCount = async (user_id: string): Promise<number> => {
    const { data, error } = await supabase
        .from("solved_problems")
        .select('problem_id')
        .eq("user_id", user_id)
        .eq("platform", "codeforces");

    if(error)
        throw new Error(`Error while fetching solved count for ${user_id}: ${error.message}`);

    return new Set(data.map(d => d.problem_id)).size;
}
