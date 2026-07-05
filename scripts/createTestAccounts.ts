import { supabase } from "../db/supabase.ts";
import { setupUser } from "../jobs/problemSolved.ts";
import { platformMain } from "./refreshPlatformData.ts";
import { heatMapMain } from "./refreshHeatmap.ts";
import { backfillMain } from "./backfillDailyCount.ts";
import { refreshUserContests } from "../jobs/contestRefresh.ts";
import { syncAssignmentCompletions } from "../jobs/assignmentSync.ts";
import { updateDailyCountForUser } from "../jobs/dailyCount.ts";
import { updateStreakForUser } from "../jobs/streak.ts";

/**
 * One-off script to create test mentee accounts, each pre-loaded with one
 * real handle per platform (leetcode + codeforces + atcoder), then run the
 * same "fresh init" pipeline the onboarding flow triggers for a brand-new
 * user (full historical import + heatmap + daily-count backfill + contest
 * sync) for every platform on the account.
 *
 * Usage:
 *   tsx scripts/createTestAccounts.ts
 */

type Platform = "leetcode" | "codeforces" | "atcoder";

interface TestAccountSpec {
    /** Used to build the login email/profile name — pick any handle on the account. */
    label: string;
    handles: Partial<Record<Platform, string>>;
}

const TEST_ACCOUNTS: TestAccountSpec[] = [
    { label: "la_castille", handles: { leetcode: "la_castille", codeforces: "hgopani", atcoder: "Manan23mp" } },
    { label: "rzwq", handles: { leetcode: "rzwq", codeforces: "Bhaskar_Nath", atcoder: "zssa" } },
    { label: "DARK_ANGEL_689", handles: { leetcode: "DARK_ANGEL_689", codeforces: "shivnshshrma", atcoder: "tomo0918" } },
];

const TEST_EMAIL_DOMAIN = "algomentor-test.dev";
const TEST_PASSWORD = "TestAccount#2026";

function emailFor(label: string): string {
    const slug = label.toLowerCase().replace(/[^a-z0-9]/g, "");
    return `${slug}@${TEST_EMAIL_DOMAIN}`;
}

/** Creates the auth user (or reuses it if it already exists) and returns its id. */
async function ensureAuthUser(label: string, email: string): Promise<string> {
    const { data, error } = await supabase.auth.admin.createUser({
        email,
        password: TEST_PASSWORD,
        email_confirm: true,
        user_metadata: { name: label },
    });

    if (!error && data.user) {
        console.log(`[CreateTestAccounts] Created auth user for ${label} (${email}) -> ${data.user.id}`);
        return data.user.id;
    }

    const alreadyExists = error?.message?.toLowerCase().includes("already") ?? false;
    if (!alreadyExists) {
        throw new Error(`Failed to create auth user for ${label}: ${error?.message}`);
    }

    // Already registered from a previous run — look it up instead.
    console.log(`[CreateTestAccounts] Auth user for ${label} (${email}) already exists, looking it up...`);
    let page = 1;
    const perPage = 200;
    for (;;) {
        const { data: listData, error: listError } = await supabase.auth.admin.listUsers({ page, perPage });
        if (listError) {
            throw new Error(`Failed to list users while resolving ${email}: ${listError.message}`);
        }
        const match = listData.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
        if (match) {
            return match.id;
        }
        if (listData.users.length < perPage) {
            break;
        }
        page += 1;
    }

    throw new Error(`Could not find existing auth user for ${email}`);
}

// `profile` has no unique constraint on user_id (mirrors completeOnboarding's
// manual check-then-insert-or-update instead of relying on upsert).
async function upsertProfile(userId: string, spec: TestAccountSpec): Promise<void> {
    const { data: existing, error: fetchError } = await supabase
        .from("profile")
        .select("user_id")
        .eq("user_id", userId)
        .maybeSingle();

    if (fetchError) {
        throw new Error(`Failed to look up profile for ${spec.label}: ${fetchError.message}`);
    }

    const handleSummary = Object.entries(spec.handles)
        .map(([platform, handle]) => `${platform}:${handle}`)
        .join(", ");

    const payload = {
        name: spec.label,
        description: `Test account (seeded for QA) — ${handleSummary}`,
        onboarding_completed: true,
    };

    const { error } = existing
        ? await supabase.from("profile").update(payload).eq("user_id", userId)
        : await supabase.from("profile").insert({ user_id: userId, ...payload });

    if (error) {
        throw new Error(`Failed to save profile for ${spec.label}: ${error.message}`);
    }
}

async function upsertPlatformHandle(userId: string, platform: Platform, handle: string): Promise<void> {
    const { error } = await supabase
        .from("user_platforms")
        .upsert({ user_id: userId, platform, handle }, { onConflict: "user_id,platform" });

    if (error) {
        throw new Error(`Failed to upsert ${platform} handle for ${handle}: ${error.message}`);
    }
}

/** Mirrors POST /refresh/fresh-init, run inline so we can await full completion. */
async function runFreshInit(userId: string, label: string): Promise<void> {
    console.log(`[CreateTestAccounts] Running fresh-init for ${label} (${userId})...`);

    await setupUser(userId);

    await Promise.all([
        platformMain(userId),
        heatMapMain(userId),
        backfillMain(userId),
        refreshUserContests(userId),
    ]);

    // Bring daily_count/streak in line with the freshly-imported history, and
    // check whether any pending mentor assignments got auto-completed.
    await updateDailyCountForUser(userId);
    await updateStreakForUser(userId);
    await syncAssignmentCompletions(userId);

    console.log(`[CreateTestAccounts] Fresh-init complete for ${label}.`);
}

async function main(): Promise<void> {
    console.log(`[CreateTestAccounts] Seeding ${TEST_ACCOUNTS.length} test accounts...`);

    for (const spec of TEST_ACCOUNTS) {
        const email = emailFor(spec.label);
        try {
            const userId = await ensureAuthUser(spec.label, email);
            await upsertProfile(userId, spec);

            for (const [platform, handle] of Object.entries(spec.handles) as [Platform, string][]) {
                await upsertPlatformHandle(userId, platform, handle);
            }

            await runFreshInit(userId, spec.label);

            const handleSummary = Object.entries(spec.handles)
                .map(([platform, handle]) => `${platform}=${handle}`)
                .join(", ");
            console.log(`[CreateTestAccounts] ✓ ${spec.label} ready — user_id=${userId}, email=${email}, handles: ${handleSummary}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`[CreateTestAccounts] ✗ ${spec.label} failed: ${message}`);
        }
    }

    console.log("[CreateTestAccounts] Done. Login password for all test accounts:", TEST_PASSWORD);
}

await main();
