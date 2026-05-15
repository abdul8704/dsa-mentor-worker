import { getSolvedCountsByDateInRange } from "../repository/solvedProblems.repo.ts";

export type UserHeatmap = Record<string, number>;

const formatUTCDate = (date: Date): string => date.toISOString().split("T")[0]!;

export const getHeatmapDateRange = (): { fromDate: string; toDate: string } => {
    const toDate = formatUTCDate(new Date());
    const start = new Date();
    start.setUTCFullYear(start.getUTCFullYear() - 1);
    const fromDate = formatUTCDate(start);
    return { fromDate, toDate };
};

const enumerateDates = (fromDate: string, toDate: string): string[] => {
    const dates: string[] = [];
    const current = new Date(`${fromDate}T00:00:00.000Z`);
    const end = new Date(`${toDate}T00:00:00.000Z`);

    while (current <= end) {
        dates.push(formatUTCDate(current));
        current.setUTCDate(current.getUTCDate() + 1);
    }

    return dates;
};

export const getUserHeatmap = async (user_id: string): Promise<UserHeatmap> => {
    const { fromDate, toDate } = getHeatmapDateRange();
    const countsByDate = await getSolvedCountsByDateInRange(user_id, fromDate, toDate);

    const heatmap: UserHeatmap = {};
    for (const date of enumerateDates(fromDate, toDate)) {
        heatmap[date] = countsByDate.get(date) ?? 0;
    }

    return heatmap;
};
