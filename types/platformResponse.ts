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

export type CodeforcesRatingChange = {
  contestId: number;
  contestName: string;
  handle: string;
  rank: number;
  ratingUpdateTimeSeconds: number;
  oldRating: number;
  newRating: number;
};

export type AtcoderContestHistory = {
  IsRated: boolean;
  Place: number;
  OldRating: number;
  NewRating: number;
  Performance: number;
  InnerPerformance: number;
  ContestScreenName: string;
  ContestName: string;
  ContestNameEn: string;
  EndTime: string;
};

export type LeetCodeContestHistory = {
  attended: boolean;
  rating: number;
  ranking: number;
  contest: {
    title: string;
    startTime: number;
  };
};
// ─── CSES ────────────────────────────────────────────────────────────────
// CSES has no public API: every type below is scraped from logged-in HTML
// (services/cses/client.ts). See CSES_INTEGRATION_PLAN.md for the pages.

export type CSESAccount = {
  userId: number;
  username: string;
};

export type CSESTaskStatus = "solved" | "attempted" | "untouched";

/** One row of /problemset/list/ — a task's category, global stats, and the viewer's own status. */
export type CSESTask = {
  taskId: number;
  name: string;
  category: string;
  solvedBy: number;
  attemptedBy: number;
  status: CSESTaskStatus;
};

/**
 * One accepted submission from /problemset/view/{task}/. Carries the parent
 * task's metadata denormalized onto it (CSES has no per-submission problem
 * payload the way Codeforces/AtCoder do), so filterNewSolvedCSES can build a
 * `problems` catalog row without a second fetch.
 */
export type CSESSubmission = {
  submissionId: number;
  taskId: number;
  taskName: string;
  category: string;
  solvedBy: number;
  attemptedBy: number;
  /** UTC ISO instant — converted from CSES's Finnish-local display time. */
  submittedAt: string;
  language: string;
  accepted: boolean;
};
