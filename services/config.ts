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
        })
    }
};