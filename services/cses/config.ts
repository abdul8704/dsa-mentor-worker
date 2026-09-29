export const CSES_API = {
    BASE_URL: "https://cses.fi",

    endpoints: {
        loginPage: () => "/login",
        login: () => "/login",
        taskList: () => "/problemset/list/",
        // CSES's own submission-list pagination is 1-based; page 1 has no
        // trailing segment on the site, but "/view/{id}/1" resolves the same.
        taskView: (taskId: number, page: number) => `/problemset/view/${taskId}/${page}`,
    },
};

/**
 * CSES renders every submission time in Finnish local time (the submission
 * detail page shows e.g. "2026-02-03 08:04:54 +0200"), never UTC and never
 * with the offset on the /view/ list page itself. Every timestamp scraped
 * from CSES must be converted from this zone to UTC before being stored, to
 * stay consistent with how daily_count/streak bucket every other platform's
 * solved_date (see utils/tzConvert.ts and CSES_INTEGRATION_PLAN.md §6).
 */
export const CSES_TIMEZONE = "Europe/Helsinki";

/** Minimum spacing between *any* two CSES requests, across ALL mentees. */
export const CSES_MIN_REQUEST_INTERVAL_MS = 1200;
