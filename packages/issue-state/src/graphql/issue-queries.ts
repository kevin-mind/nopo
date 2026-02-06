export const GET_ISSUE_WITH_PROJECT_QUERY = `
query GetIssueWithProject($owner: String!, $repo: String!, $issueNumber: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $issueNumber) {
      id
      number
      title
      body
      state
      assignees(first: 10) {
        nodes {
          login
        }
      }
      labels(first: 20) {
        nodes {
          name
        }
      }
      parent {
        number
      }
      projectItems(first: 10) {
        nodes {
          id
          project {
            id
            number
          }
          fieldValues(first: 20) {
            nodes {
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
                field {
                  ... on ProjectV2SingleSelectField {
                    name
                    id
                  }
                }
              }
              ... on ProjectV2ItemFieldNumberValue {
                number
                field {
                  ... on ProjectV2Field {
                    name
                    id
                  }
                }
              }
            }
          }
        }
      }
      subIssues(first: 20) {
        nodes {
          id
          number
          title
          body
          state
          projectItems(first: 10) {
            nodes {
              project {
                number
              }
              fieldValues(first: 20) {
                nodes {
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    name
                    field {
                      ... on ProjectV2SingleSelectField {
                        name
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
      comments(first: 50) {
        nodes {
          id
          author {
            login
          }
          body
          createdAt
        }
      }
    }
  }
}
`;

export const GET_PR_FOR_BRANCH_QUERY = `
query GetPRForBranch($owner: String!, $repo: String!, $headRef: String!) {
  repository(owner: $owner, name: $repo) {
    pullRequests(first: 1, headRefName: $headRef, states: [OPEN, MERGED]) {
      nodes {
        number
        title
        state
        isDraft
        headRefName
        baseRefName
        commits(last: 1) {
          nodes {
            commit {
              statusCheckRollup {
                state
              }
            }
          }
        }
      }
    }
  }
}
`;

export const CHECK_BRANCH_EXISTS_QUERY = `
query CheckBranchExists($owner: String!, $repo: String!, $branchName: String!) {
  repository(owner: $owner, name: $repo) {
    ref(qualifiedName: $branchName) {
      name
    }
  }
}
`;

export const GET_ISSUE_BODY_QUERY = `
query GetIssueBody($owner: String!, $repo: String!, $issueNumber: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $issueNumber) {
      id
      body
      parent {
        number
      }
    }
  }
}
`;
