export const CODEFORCES_API = {
    BASE_URL: "https://codeforces.com/api",

    endpoints: {
        userStatus: (handle: string, from: number, count: number) => `/user.status?handle=${handle}&from=${from}&count=${count}`,
        userInfo: (handle: string) => `/user.info?handles=${handle}&checkHistoricHandles=false`,
        userRating: (handle: string) => `/user.rating?handle=${handle}`,
    }
}

export const ATCODER_API = {
    BASE_URL: "https://kenkoooo.com/atcoder/atcoder-api/v3/user",

    endpoints: {
        userSubmissions: (handle: string, from_time: number) => `/submissions?user=${handle}&from_second=${from_time}`,
        acceptedCount: (handle: string) => `/ac_rank?user=${handle}`,
        rating: (handle: string) => `https://atcoder.jp/users/${handle}/history/json`
    }
}

export const LEETCODE_API = {
    BASE_URL: "https://leetcode.com/graphql",

    endpoints: {
        // Get user profile + solved counts
        userProfile: (username: string) => ({
            query: `
                query getUserProfile($username: String!) {
                    matchedUser(username: $username) {
                        username
                        submitStats {
                            acSubmissionNum {
                                difficulty
                                count
                                submissions
                            }
                        }
                    }
                }
            `,
            variables: { username }
        }),

        // Get recent submissions (recently solved)
        recentSubmissions: (username: string) => ({
            query: `
                query recentSubmissions($username: String!) {
                    recentSubmissionList(username: $username) {
                        title
                        titleSlug
                        timestamp
                        statusDisplay
                        lang
                    }
                }
            `,
            variables: { username }
        }),

        questionBySlug: (titleSlug: string) => ({
            query: `
                query getQuestion($titleSlug: String!) {
                question(titleSlug: $titleSlug) {
                    questionId
                    title
                    titleSlug
                    difficulty
                    topicTags {
                        slug
                    }
                }
                }
            `,
            variables: { titleSlug }
        }),

        // Get user contest ranking history, plus the live attended-contests
        // counter (updates immediately on submission; the detailed history
        // entries below can lag behind it by up to ~1 day for a contest that
        // just ended — see refreshLeetCodeContests's pending-contest handling).
        contestHistory: (username: string) => ({
            query: `
                query userContestRankingHistory($username: String!) {
                    userContestRankingHistory(username: $username) {
                        attended
                        rating
                        ranking
                        contest {
                            title
                            startTime
                        }
                    }
                    userContestRanking(username: $username) {
                        attendedContestsCount
                    }
                }
            `,
            variables: { username }
        }),

        // All LeetCode contests (past + upcoming), used to identify recent
        // contests missing from userContestRankingHistory (see above).
        allContests: () => ({
            query: `
                query allContests {
                    allContests {
                        title
                        titleSlug
                        startTime
                        duration
                    }
                }
            `,
        }),

        // Get user submission calendar (heatmap data) + streak
        submissionCalendar: (username: string) => ({
            query: `
                query userProfileCalendar($username: String!, $year: Int) {
                    matchedUser(username: $username) {
                        userCalendar(year: $year) {
                            streak
                            submissionCalendar
                        }
                    }
                }
            `,
            variables: { username }
        }),

        // ── Authenticated (need the user's LEETCODE_SESSION + csrftoken) ──
        // Used by services/leetcode/history.ts for the full-history import.
        // See LEETCODE_FULL_HISTORY_PLAN.md — shapes are from LeetCode's own
        // web client and are not a documented/stable API.

        // Who the pasted session belongs to.
        userStatus: () => ({
            query: `
                query globalData {
                    userStatus {
                        isSignedIn
                        username
                    }
                }
            `,
        }),

        // The signed-in user's submissions, newest first, 20 per page.
        // Pass back `lastKey` from the previous page — offset alone stops
        // working past a certain depth. Optional questionSlug narrows it to
        // one problem (used to find a single problem's first AC).
        submissionList: (offset: number, limit: number, lastKey: string | null, questionSlug: string | null = null) => ({
            query: `
                query submissionList($offset: Int!, $limit: Int!, $lastKey: String, $questionSlug: String) {
                    submissionList(offset: $offset, limit: $limit, lastKey: $lastKey, questionSlug: $questionSlug) {
                        lastKey
                        hasNext
                        submissions {
                            id
                            title
                            titleSlug
                            timestamp
                            statusDisplay
                            lang
                        }
                    }
                }
            `,
            variables: { offset, limit, lastKey, questionSlug }
        }),

        // Problem catalog page. With a session and filters { status: "AC" }
        // it lists only problems the user has solved; without, it's the
        // public catalog (used to fill the problems table in bulk).
        problemsetQuestionList: (skip: number, limit: number, filters: Record<string, string> = {}) => ({
            query: `
                query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
                    problemsetQuestionList: questionList(categorySlug: $categorySlug, limit: $limit, skip: $skip, filters: $filters) {
                        total: totalNum
                        questions: data {
                            questionId: questionFrontendId
                            title
                            titleSlug
                            difficulty
                            status
                            topicTags {
                                slug
                            }
                        }
                    }
                }
            `,
            variables: { categorySlug: "", skip, limit, filters }
        })
    }
};