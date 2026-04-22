export const CODEFORCES_API = {
    BASE_URL: "https://codeforces.com/api",

    endpoints: {
        userStatus: (handle: string, from: number, count: number) => `/user.status?handle=${handle}&from=${from}&count=${count}`,
        userInfo: (handles: string[]) => `/user.info?handles=${handles.join(";")}`,
        userRating: (handle: string) => `/user.rating?handle=${handle}`,
    }
}