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

export type AtcoderCountResponse = {
  count: number,
  rank: number
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