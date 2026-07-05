import { supabase } from "../db/supabase.ts";
import { deleteUserCompletely } from "../repository/admin.repo.ts";

/**
 * One-off script to purge every seeded test account (any auth user whose
 * email lives under the @algomentor-test.dev domain) along with all of
 * their data, using the same deleteUserCompletely() the /admin/delete-user
 * endpoint uses.
 *
 * Usage:
 *   tsx scripts/deleteTestAccounts.ts
 */

const TEST_EMAIL_DOMAIN = "@algomentor-test.dev";

async function findTestUsers(): Promise<{ id: string; email: string }[]> {
    const matches: { id: string; email: string }[] = [];
    let page = 1;
    const perPage = 200;

    for (;;) {
        const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
        if (error) {
            throw new Error(`Failed to list users: ${error.message}`);
        }

        data.users.forEach((u) => {
            if (u.email?.toLowerCase().endsWith(TEST_EMAIL_DOMAIN)) {
                matches.push({ id: u.id, email: u.email });
            }
        });

        if (data.users.length < perPage) break;
        page += 1;
    }

    return matches;
}

async function main(): Promise<void> {
    const testUsers = await findTestUsers();

    if (testUsers.length === 0) {
        console.log("[DeleteTestAccounts] No test accounts found.");
        return;
    }

    console.log(`[DeleteTestAccounts] Found ${testUsers.length} test account(s) to delete:`);
    testUsers.forEach((u) => console.log(`  - ${u.email} (${u.id})`));

    for (const user of testUsers) {
        const result = await deleteUserCompletely(user.id);
        if (result.errors.length > 0) {
            console.error(`[DeleteTestAccounts] ✗ ${user.email}: ${result.errors.join("; ")}`);
        } else {
            console.log(`[DeleteTestAccounts] ✓ ${user.email} deleted. Rows removed: ${JSON.stringify(result.deletedRows)}`);
        }
    }

    console.log("[DeleteTestAccounts] Done.");
}

await main();
