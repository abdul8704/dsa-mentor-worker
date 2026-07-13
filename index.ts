import express from "express";
import cors from "cors";

import { userHeatmapRouter } from "./routes/userHeatmap.ts";
import { refreshRouter } from "./routes/refresh.ts";
import { problemMetaRouter } from "./routes/problemMeta.ts";
import { adminRouter } from "./routes/admin.ts";
import { startRefreshCron } from "./jobs/refreshCron.ts";

const app = express();

app.use(
  cors({
    origin: ["http://localhost:3000", "https://dsa-mentor-seven.vercel.app"], // Next.js frontend
    credentials: true,
  })
);

app.use(express.json());

app.get("/", (_req, res) => {
  res.send("Hello, Worldddddddddddd!");
});

app.use("/user-heatmap", userHeatmapRouter);
app.use("/refresh", refreshRouter);
app.use("/problem-meta", problemMetaRouter);
app.use("/admin", adminRouter);

app.listen(5000, () => {
  console.log("Server is running on port 5000");
});

startRefreshCron();