// Content script for LeetCode

console.log("AlgoCommit: LeetCode content script loaded.");

const GET_SUBMISSIONS = `
query submissionList($offset: Int!, $limit: Int!, $lastKey: String, $questionSlug: String!, $lang: Int, $status: Int) {
  questionSubmissionList(
    offset: $offset
    limit: $limit
    lastKey: $lastKey
    questionSlug: $questionSlug
    lang: $lang
    status: $status
  ) {
    submissions {
      id
      status
    }
  }
}
`;

const GET_SUBMISSION_DETAILS = `
query submissionDetails($submissionId: Int!) {
  submissionDetails(submissionId: $submissionId) {
    code
    lang {
      name
      verboseName
    }
    question {
      difficulty
      title
      content
    }
  }
}
`;

async function fetchGraphQL(query, variables) {
  const response = await fetch("https://leetcode.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  return response.json();
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "GET_LEETCODE_SUBMISSION") {
    console.log("AlgoCommit: Checking submission for", request.questionSlug);
    handleLeetCodeSubmission(request.questionSlug);
    sendResponse({ status: "processing" });
  }
});

async function handleLeetCodeSubmission(questionSlug) {
  try {
    // 1. Get latest accepted submission ID (status: 10 = accepted)
    const listRes = await fetchGraphQL(GET_SUBMISSIONS, {
      questionSlug,
      limit: 1,
      offset: 0,
      lastKey: null,
      status: 10,
    });

    const submissions = listRes?.data?.questionSubmissionList?.submissions;
    if (!submissions || submissions.length === 0) {
      console.log("AlgoCommit: No accepted submission found yet.");
      return;
    }

    const latestSubmissionId = submissions[0].id;

    // 2. Get details
    const detailsRes = await fetchGraphQL(GET_SUBMISSION_DETAILS, {
      submissionId: parseInt(latestSubmissionId),
    });

    const details = detailsRes?.data?.submissionDetails;
    if (!details) return;

    // 3. Format Payload
    const payload = {
      platform: "LeetCode",
      title: details.question.title,
      difficulty: details.question.difficulty,
      description: details.question.content,
      language: details.lang.name,
      code: details.code,
      url: `https://leetcode.com/problems/${questionSlug}/`,
    };

    // 4. Send back to background
    chrome.runtime.sendMessage({ type: "SYNC_PROBLEM", payload }, (res) => {
      console.log("AlgoCommit: Sync result:", res);
    });
  } catch (error) {
    console.error("AlgoCommit Error:", error);
  }
}
