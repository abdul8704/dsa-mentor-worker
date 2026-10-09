import { buildCsesDifficultyIndex } from "./utils/csesDifficulty.ts";
const mk = (cat: string, counts: number[], base: number) => counts.map((solvedBy, i) => ({ taskId: base + i, category: cat, solvedBy }));
const tasks = [
  ...mk("Introductory Problems", [150000, 90000, 70000, 40000, 20000, 12000], 100),
  ...mk("Dynamic Programming", [40000, 30000, 15000, 8000, 4000, 2000], 200),
  ...mk("Advanced Techniques", [3000, 1500, 600, 300], 300),
  ...mk("Counting Problems", [400, 200, 90], 400),
];
const idx = buildCsesDifficultyIndex(tasks);
for (const t of tasks) console.log(t.category.padEnd(22), String(t.solvedBy).padStart(6), idx.get(t.taskId));
