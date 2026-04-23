export const CODEFORCES_API = {
    BASE_URL: "https://codeforces.com/api",

    endpoints: {
        userStatus: (handle: string, from: number, count: number) => `/user.status?handle=${handle}&from=${from}&count=${count}`,
        userInfo: (handles: string[]) => `/user.info?handles=${handles.join(";")}`,
        userRating: (handle: string) => `/user.rating?handle=${handle}`,
    }
}

export const ATCODER_API = {
    BASE_URL: "https://kenkoooo.com/atcoder/atcoder-api/v3/user",

    endpoints: {
        userSubmissions: (handle: string, from_time: number) => `/submissions?user=${handle}&from_second=${from_time}`,
        acceptedCount: (handle: string) => `/ac_rank?user=${handle}`,
    }
}