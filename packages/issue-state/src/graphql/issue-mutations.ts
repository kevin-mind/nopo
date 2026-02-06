export const CREATE_ISSUE_MUTATION = `
mutation CreateIssue($repositoryId: ID!, $title: String!, $body: String!) {
  createIssue(input: { repositoryId: $repositoryId, title: $title, body: $body }) {
    issue {
      id
      number
    }
  }
}
`;

export const ADD_SUB_ISSUE_MUTATION = `
mutation AddSubIssue($parentId: ID!, $childId: ID!) {
  addSubIssue(input: { issueId: $parentId, subIssueId: $childId }) {
    issue {
      id
    }
  }
}
`;

export const GET_REPO_ID_QUERY = `
query GetRepoId($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    id
  }
}
`;
