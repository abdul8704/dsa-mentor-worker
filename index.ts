import express from "express";
import { userHeatmapRouter } from "./routes/userHeatmap.ts";

const app = express();

app.get("/", (_req, res) => {
  res.send("Hello, World!");
});

app.use("/user-heatmap", userHeatmapRouter);

app.listen(3000, () => {
    console.log("Server is running on port 3000");
});