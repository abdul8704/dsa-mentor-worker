import cron from "node-cron";
import { runFullRefreshForAllUsers, runFullRefreshForWidgetUsers, type BatchResult } from "./refreshPipeline.ts";

/**
 * Two recurring refresh jobs (standard 5-field cron syntax:
 * "minute hour day month weekday"):
 *
 *   REFRESH_CRON_SCHEDULE         every user without a connected widget.
 *                                 Default every 3 hours ("0 *\/3 * * *").
 *   WIDGET_REFRESH_CRON_SCHEDULE  users with at least one connected desktop
 *                                 widget, so the widget stays current.
 *                                 Default every 5 minutes ("*\/5 * * * *").
 *
 * Each job skips a tick while its previous run is still going, and a user
 * already being refreshed by the other job is skipped (see refreshPipeline).
 */
const jobs = [
    {
        name: "RefreshCron",
        envVar: "REFRESH_CRON_SCHEDULE",
        fallback: "0 */3 * * *",
        run: runFullRefreshForAllUsers,
    },
    {
        name: "WidgetRefreshCron",
        envVar: "WIDGET_REFRESH_CRON_SCHEDULE",
        fallback: "*/5 * * * *",
        run: runFullRefreshForWidgetUsers,
    },
] as const;

const makeRunner = (name: string, run: () => Promise<BatchResult>) => {
    let isRunning = false;
    return async () => {
        if (isRunning) {
            console.log(`[${name}] Skipping run — previous refresh is still in progress.`);
            return;
        }

        isRunning = true;
        console.log(`[${name}] Starting scheduled refresh at ${new Date().toISOString()}`);

        try {
            const { total, processed, failed, skipped } = await run();
            console.log(`[${name}] Finished. total=${total} processed=${processed} failed=${failed} skipped=${skipped}`);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "Unknown error";
            console.error(`[${name}] Scheduled refresh crashed: ${message}`);
        } finally {
            isRunning = false;
        }
    };
};

/**
 * Registers both recurring refresh jobs. Call once at server startup
 * (e.g. from index.ts).
 */
export const startRefreshCron = (): void => {
    for (const job of jobs) {
        const configured = process.env[job.envVar]?.trim() || job.fallback;
        let expression: string = configured;
        if (!cron.validate(configured)) {
            console.error(`[${job.name}] Invalid ${job.envVar} "${configured}" — falling back to "${job.fallback}"`);
            expression = job.fallback;
        }
        cron.schedule(expression, makeRunner(job.name, job.run));
        console.log(`[${job.name}] Scheduled with expression "${expression}"`);
    }
};
