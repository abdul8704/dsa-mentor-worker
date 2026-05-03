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

        // Get full solved problems list (accepted submissions)
        solvedProblems: (username: string, limit = 2000) => ({
            query: `
                query userSolvedProblems($username: String!, $limit: Int!) {
                    matchedUser(username: $username) {
                        submitStatsGlobal {
                            acSubmissionNum {
                                difficulty
                                count
                            }
                        }
                        userCalendar {
                            submissionCalendar
                        }
                    }
                    recentAcSubmissionList(username: $username, limit: $limit) {
                        id
                        title
                        titleSlug
                        timestamp
                    }
                }
            `,
            variables: { username, limit }
        })
    }
};



export const fetchLeetCodeData = async () => {
    const { query, variables } = LEETCODE_API.endpoints.solvedProblems("abdulaziz120");

    const res = await fetch(LEETCODE_API.BASE_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            query,
            variables
        })
    });

    const data = await res.json();
console.log(data.data.matchedUser.submitStatsGlobal.acSubmissionNum.length, data.data.recentAcSubmissionList.length);
    // return res.data;
};

fetchLeetCodeData()