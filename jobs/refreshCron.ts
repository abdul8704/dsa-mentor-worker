import cron from "node-cron";
import { runFullRefreshForAllUsers } from "./refreshPipeline.ts";

/**
 * Cron schedule for the recurring "refresh all users" job.
 *
 * Configurable via the REFRESH_CRON_SCHEDULE env var (standard 5-field cron
 * syntax: "minute hour day month weekday"). Defaults to every 3 hours.
 *
 * Examples:
 *   "0 *\/3 * * *"  -> every 3 hours (default)
 *   "0 *\/1 * * *"  -> every hour
 *   "0 0 * * *"    -> once a day at midnight
 */
const DEFAULT_SCHEDULE = "0 */3 * * *";
const schedule = process.env.REFRESH_CRON_SCHEDULE?.trim() || DEFAULT_SCHEDULE;

let isRunning = false;

const runJob = async () => {
    if (isRunning) {
        console.log("[RefreshCron] Skipping run — previous refresh is still in progress.");
        return;
    }

    isRunning = true;
    const startedAt = new Date().toISOString();
    console.log(`[RefreshCron] Starting scheduled full refresh at ${startedAt}`);

    try {
        const { total, processed, failed } = await runFullRefreshForAllUsers();
        console.log(`[RefreshCron] Finished. total=${total} processed=${processed} failed=${failed}`);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error(`[RefreshCron] Scheduled refresh crashed: ${message}`);
    } finally {
        isRunning = false;
    }
};

/**
 * Registers the recurring refresh-all-users cron job. Call once at server
 * startup (e.g. from index.ts).
 */
export const startRefreshCron = (): void => {
    if (!cron.validate(schedule)) {
        console.error(`[RefreshCron] Invalid cron schedule "${schedule}" — falling back to default "${DEFAULT_SCHEDULE}"`);
        cron.schedule(DEFAULT_SCHEDULE, runJob);
        console.log(`[RefreshCron] Scheduled with default expression "${DEFAULT_SCHEDULE}"`);
        return;
    }

    cron.schedule(schedule, runJob);
    console.log(`[RefreshCron] Scheduled with expression "${schedule}"`);
};
