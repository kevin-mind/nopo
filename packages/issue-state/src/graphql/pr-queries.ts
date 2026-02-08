export const CONVERT_PR_TO_DRAFT_MUTATION = `
mutation ConvertPRToDraft($prId: ID!) {
  convertPullRequestToDraft(input: { pullRequestId: $prId }) {
    pullRequest {
      id
      isDraft
    }
  }
}
`;

export const MARK_PR_READY_MUTATION = `
mutation MarkPRReady($prId: ID!) {
  markPullRequestReadyForReview(input: { pullRequestId: $prId }) {
    pullRequest {
      id
      isDraft
    }
  }
}
`;

export const GET_PR_ID_QUERY = `
query GetPRId($owner: String!, $repo: String!, $prNumber: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $prNumber) {
      id
    }
  }
}
`;

export const GET_PR_REVIEWS_QUERY = `
query GetPRReviews($owner: String!, $repo: String!, $prNumber: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $prNumber) {
      reviews(first: 50) {
        nodes {
          id
          state
          author { login }
          body
        }
      }
    }
  }
}
`;
