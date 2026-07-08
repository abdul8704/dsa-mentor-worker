import { supabase } from "../db/supabase.ts";

/**
 * Every table that stores rows scoped to a user (directly or via a
 * mentor/mentee relationship), plus the column(s) that hold the user id.
 * `problems` is intentionally excluded — it's a shared, platform-wide
 * catalog, never user-scoped.
 */
const USER_SCOPED_TABLES: { table: string; columns: string[] }[] = [
    { table: "assignments", columns: ["mentor_id", "mentee_id"] },
    { table: "mentor_notes", columns: ["mentor_id", "mentee_id"] },
    { table: "mentee_group_members", columns: ["mentee_id"] },
    { table: "mentee_groups", columns: ["mentor_id"] },
    { table: "mentorships", columns: ["mentor_id", "mentee_id"] },
    { table: "invites", columns: ["mentor_id", "invitee_user_id"] },
    { table: "daily_count", columns: ["user_id"] },
    { table: "solved_problems", columns: ["user_id"] },
    { table: "user_contest", columns: ["user_id"] },
    { table: "user_platform_data", columns: ["user_id"] },
    { table: "user_platforms", columns: ["user_id"] },
    { table: "user-streak", columns: ["user_id"] },
    { table: "profile", columns: ["user_id"] },
];

export interface DeleteUserResult {
    userId: string;
    deletedRows: Record<string, number>;
    authUserDeleted: boolean;
    errors: string[];
}

/**
 * Permanently deletes a user: every row in every user-scoped table that
 * references them (as owner, mentor, or mentee), then the Supabase Auth user
 * itself. Best-effort across tables — a failure in one table doesn't stop
 * the others, so partial cleanup never leaves the operation half-started.
 */
export async function deleteUserCompletely(userId: string): Promise<DeleteUserResult> {
    const deletedRows: Record<string, number> = {};
    const errors: string[] = [];

    for (const { table, columns } of USER_SCOPED_TABLES) {
        let tableCount = 0;

        for (const column of columns) {
            const { data, error } = await supabase
                .from(table)
                .delete()
                .eq(column, userId)
                .select(column);

            if (error) {
                errors.push(`${table}.${column}: ${error.message}`);
                console.error(`[AdminDelete] Failed deleting ${table} where ${column}=${userId}: ${error.message}`);
                continue;
            }

            tableCount += data?.length ?? 0;
        }

        if (tableCount > 0) {
            deletedRows[table] = tableCount;
        }
    }

    let authUserDeleted = false;
    const { error: authError } = await supabase.auth.admin.deleteUser(userId);
    if (authError) {
        // "User not found" just means it was already gone — not a failure.
        if (!authError.message.toLowerCase().includes("not found")) {
            errors.push(`auth.users: ${authError.message}`);
            console.error(`[AdminDelete] Failed deleting auth user ${userId}: ${authError.message}`);
        }
    } else {
        authUserDeleted = true;
    }

    console.log(
        `[AdminDelete] user=${userId} deletedRows=${JSON.stringify(deletedRows)} authUserDeleted=${authUserDeleted} errors=${errors.length}`
    );

    return { userId, deletedRows, authUserDeleted, errors };
}
