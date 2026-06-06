import express from "express";
import cors from "cors";

import { userHeatmapRouter } from "./routes/userHeatmap.ts";
import { refreshRouter } from "./routes/refresh.ts";

const app = express();

app.use(
  cors({
    origin: ["http://localhost:3000", "https://dsa-mentor-seven.vercel.app/"], // Next.js frontend
    credentials: true,
  })
);

app.use(express.json());

app.get("/", (_req, res) => {
  res.send("Hello, World!");
});

app.use("/user-heatmap", userHeatmapRouter);
app.use("/refresh", refreshRouter);

app.listen(5000, () => {
  console.log("Server is running on port 5000");
});