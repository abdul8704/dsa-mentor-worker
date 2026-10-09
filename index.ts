import express from "express";
import cors from "cors";

import { userHeatmapRouter } from "./routes/userHeatmap.ts";
import { refreshRouter } from "./routes/refresh.ts";
import { problemMetaRouter } from "./routes/problemMeta.ts";
import { adminRouter } from "./routes/admin.ts";
import { csesRouter } from "./routes/cses.ts";
import { leetcodeRouter } from "./routes/leetcode.ts";
import { startRefreshCron } from "./jobs/refreshCron.ts";

const app = express();

// Collapse leading duplicate slashes ("//cses/status" -> "/cses/status"), which
// a trailing "/" on the frontend's NEXT_PUBLIC_SERVER_URL produces and which
// Express would otherwise answer with a 404.
app.use((req, _res, next) => {
  req.url = req.url.replace(/^\/{2,}/, "/");
  next();
});

app.use(
  cors({
    // Browser Origin headers never end in "/", so entries here must not either.
    origin: ["http://localhost:3000", "https://dsa-mentor-seven.vercel.app", "https://algomentor.abdul-aziz.dev"], // Next.js frontend
    credentials: true,
  })
);

app.use(express.json());

app.get("/", (_req, res) => {
  res.send("Hello, warldd!");
});

app.use("/user-heatmap", userHeatmapRouter);
app.use("/refresh", refreshRouter);
app.use("/problem-meta", problemMetaRouter);
app.use("/admin", adminRouter);
app.use("/cses", csesRouter);
app.use("/leetcode", leetcodeRouter);

app.listen(process.env.WORKER_PORT!, () => {
  console.log(`Server is running on port ${process.env.WORKER_PORT}`);
});

startRefreshCron();