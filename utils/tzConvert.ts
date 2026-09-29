/**
 * Converts a naive "wall clock" local time (as displayed by a site in some
 * IANA time zone, with no UTC offset attached) into a UTC ISO string —
 * without pulling in a date library. Needed because CSES only ever shows
 * Finnish local time (see services/cses/config.ts).
 *
 * Uses `Intl.DateTimeFormat` to read the zone's actual UTC offset at (near)
 * the instant in question — which correctly accounts for DST — then
 * iterates once to converge in case the first guess landed on the wrong
 * side of a DST transition.
 *
 * Caveat: during the ~1 hour/year "fall back" transition, a wall-clock time
 * is genuinely ambiguous (it occurs twice, at two different UTC instants).
 * This picks whichever of the two `Intl` happens to resolve for the first
 * guess — for CSES's purposes (bucketing into a UTC calendar day for
 * streak/heatmap aggregation) this is never more than an hour off and can't
 * change which UTC day the solve lands on except in a razor-thin window
 * right at midnight, so it's accepted rather than resolved exactly.
 */
export const localWallTimeToUtcIso = (wallTime: string, timeZone: string): string => {
    const trimmed = wallTime.trim();
    const [datePart, timePart] = trimmed.split(" ");
    if (!datePart || !timePart) {
        throw new Error(`Unrecognized wall-clock time: "${wallTime}"`);
    }

    const [yearStr, monthStr, dayStr] = datePart.split("-");
    const [hourStr, minuteStr, secondStr] = timePart.split(":");
    const year = Number(yearStr);
    const month = Number(monthStr);
    const day = Number(dayStr);
    const hour = Number(hourStr);
    const minute = Number(minuteStr);
    const second = Number(secondStr ?? "0");

    if ([year, month, day, hour, minute, second].some((n) => Number.isNaN(n))) {
        throw new Error(`Unrecognized wall-clock time: "${wallTime}"`);
    }

    const wallAsUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
    let guessUtcMs = wallAsUtcMs;

    for (let i = 0; i < 2; i++) {
        const offsetMinutes = getOffsetMinutesAt(new Date(guessUtcMs), timeZone);
        guessUtcMs = wallAsUtcMs - offsetMinutes * 60_000;
    }

    return new Date(guessUtcMs).toISOString();
};

/** The zone's UTC offset (in minutes, positive = ahead of UTC) at `instant`. */
const getOffsetMinutesAt = (instant: Date, timeZone: string): number => {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    }).formatToParts(instant);

    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");

    const asUtcMs = Date.UTC(
        get("year"),
        get("month") - 1,
        get("day"),
        get("hour"),
        get("minute"),
        get("second")
    );

    return Math.round((asUtcMs - instant.getTime()) / 60_000);
};
