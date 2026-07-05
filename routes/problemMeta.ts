import { Router } from "express";
import { fetchProblemMeta } from "../services/problemMeta.ts";
import { addProbs } from "../repository/problems.repo.ts";

export const problemMetaRouter = Router();

/**
 * GET /problem-meta?url=<problem url>
 *
 * Resolves a pasted problem URL into canonical metadata, ensures the problem
 * exists in the `problems` table (so assignments can FK to it and analytics can
 * join tags/difficulty), and returns the resolved row.
 *
 * Used by the frontend assignProblem action before inserting an assignment.
 */
problemMetaRouter.get("/", async (req, res) => {
    const url = typeof req.query.url === "string" ? req.query.url : "";

    if (!url.trim()) {
        res.status(400).json({ error: "url query parameter is required" });
        return;
    }

    console.log(`[ProblemMeta] GET /problem-meta — url=${url}`);

    try {
        const problem = await fetchProblemMeta(url);

        // Upsert into the shared catalog (ignoreDuplicates keeps existing rows).
        await addProbs([problem]);

        console.log(`[ProblemMeta] Resolved ${problem.problem_id} (${problem.title})`);
        res.json({ success: true, problem });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Failed to resolve problem metadata";
        console.error(`[ProblemMeta] Failed for url=${url}: ${message}`);
        // 422 for URL/resolution problems the mentor can fix; keep message user-facing.
        res.status(422).json({ error: message });
    }
});
