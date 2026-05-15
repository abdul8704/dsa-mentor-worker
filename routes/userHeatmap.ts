import { Router } from "express";
import { getUserHeatmap } from "../services/userHeatmap.ts";

export const userHeatmapRouter = Router();

userHeatmapRouter.get("/", async (req, res) => {
    const user_id = req.query.user_id;

    if (typeof user_id !== "string" || !user_id.trim()) {
        res.status(400).json({ error: "user_id query parameter is required" });
        return;
    }

    try {
        const heatmap = await getUserHeatmap(user_id.trim());
        res.json(heatmap);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Failed to build user heatmap";
        res.status(500).json({ error: message });
    }
});
