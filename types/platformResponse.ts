import type { Database } from "./db.ts"

export type CodeforcesResponse = {
  "id": number,
  "contestId": number,
  "creationTimeSeconds": number,
  "relativeTimeSeconds": number,
  "problem": {
    "contestId": number,
    "index": string,
    "name": string,
    "type": string,
    "points": number,
    "rating": number,
    "tags": [string]
  },
  "author": {
    "contestId": number,
    "participantId": number,
    "members": [
      {
        "handle": string
      }
    ],
    "participantType": string,
    "ghost": boolean,
    "startTimeSeconds": number
  },
  "programmingLanguage": string,
  "verdict": string,
  "testset": string,
  "passedTestCount": number,
  "timeConsumedMillis": number,
  "memoryConsumedBytes": number
}

export type CodeForcesUserInfoResponse = {
  "lastName": string,
  "country": string,
  "lastOnlineTimeSeconds": number,
  "city": string,
  "rating": number,
  "friendOfCount": number,
  "titlePhoto": string,
  "handle": string,
  "avatar": string,
  "firstName": string,
  "contribution": number,
  "organization": string,
  "rank": string,
  "maxRating": number,
  "registrationTimeSeconds": number,
  "maxRank": string
}

export type CodeforcesSolvedCountResponse = {
  "rating": number,
  "maxRating": number,
  "rank": string,
  "count": number
}


export type AtcoderCountResponse = {
  count: number,
  rank: number,
  rating: number,
  maxRating: number
}

export type AtcoderSubmissionResponse = {
  "id": number,
  "epoch_second": number,
  "problem_id": string,
  "contest_id": string,
  "user_id": string,
  "language": string,
  "point": number,
  "length": number,
  "result": string,
  "execution_time": number
}

export type LeetCodeUserProfileResponse = {
  "matchedUser": {
    "username": string,
    "submitStats": {
      "acSubmissionNum": [
        {
          "difficulty": string,
          "count": number,
          "submissions": number
        }
      ]
    }
  }
}

export type LeetCodeRecentSubmissionResponse = {
  "id": string,
  "title": string,
  "titleSlug": string,
  "timestamp": number,
  "statusDisplay": string,
  "lang": string
}

export type LeetCodeQuestion = {
  "questionId": string,
  "title": string,
  "titleSlug": string,
  "difficulty": string,
  "topicTags": [
    {
      "slug": string
    }
  ]

}

export type GetProblemsResult = {
  found: Record<string, LeetCodeQuestion>;
  missing: string[];
};