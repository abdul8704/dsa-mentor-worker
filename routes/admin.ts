import { Router } from "express";
import { deleteUserCompletely, type DeleteUserResult } from "../repository/admin.repo.ts";

export const adminRouter = Router();

/**
 * POST /admin/delete-user — permanently deletes one or more users and every
 * row of their data across all user-scoped tables (assignments, mentorships,
 * invites, solved_problems, user_contest, user_platform_data, user_platforms,
 * user-streak, daily_count, profile), then the Supabase Auth user itself.
 *
 * This is IRREVERSIBLE, so it requires an explicit confirm flag.
 *
 * Body: { user_id: "..." , confirm: true }
 *   or: { user_ids: ["...", "..."], confirm: true }
 */
adminRouter.post("/delete-user", async (req, res) => {
    const { user_id, user_ids, confirm } = req.body ?? {};

    if (confirm !== true) {
        res.status(400).json({ error: "Set confirm: true to acknowledge this permanently deletes user data." });
        return;
    }

    const targets = new Set<string>();
    if (typeof user_id === "string" && user_id.trim()) targets.add(user_id.trim());
    if (Array.isArray(user_ids)) {
        user_ids.forEach((id) => typeof id === "string" && id.trim() && targets.add(id.trim()));
    }

    if (targets.size === 0) {
        res.status(400).json({ error: "Provide user_id (string) or user_ids (string[])" });
        return;
    }

    console.log(`[AdminDelete] POST /admin/delete-user — targets=${[...targets].join(", ")}`);

    const results: DeleteUserResult[] = [];
    for (const id of targets) {
        results.push(await deleteUserCompletely(id));
    }

    const failed = results.filter((r) => r.errors.length > 0);
    res.status(failed.length > 0 ? 207 : 200).json({
        success: failed.length === 0,
        processed: results.length,
        failed: failed.length,
        results,
    });
});
