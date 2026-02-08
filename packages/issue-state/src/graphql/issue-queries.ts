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
        url
        mergeable
        reviewDecision
        reviews(first: 50) {
          totalCount
        }
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

export const GET_SUB_ISSUES_QUERY = `
query GetSubIssues($owner: String!, $repo: String!, $issueNumber: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $issueNumber) {
      subIssues(first: 50) {
        nodes {
          id
          number
          title
          state
        }
      }
    }
  }
}
`;

export const GET_ISSUE_PROJECT_STATUS_QUERY = `
query GetIssueProjectStatus($owner: String!, $repo: String!, $issueNumber: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $issueNumber) {
      id
      state
      projectItems(first: 10) {
        nodes {
          fieldValues(first: 20) {
            nodes {
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
                field { ... on ProjectV2SingleSelectField { name } }
              }
            }
          }
        }
      }
    }
  }
}
`;

export const GET_REPOSITORY_INFO_QUERY = `
query GetRepositoryInfo($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    id
  }
}
`;

export const GET_ISSUE_LINKED_PRS_QUERY = `
query GetIssueLinkedPRs($owner: String!, $repo: String!, $issueNumber: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $issueNumber) {
      id
      number
      timelineItems(first: 50, itemTypes: [CROSS_REFERENCED_EVENT, CONNECTED_EVENT]) {
        nodes {
          ... on CrossReferencedEvent {
            source {
              ... on PullRequest {
                number
                title
                state
                headRefName
                url
              }
            }
          }
          ... on ConnectedEvent {
            subject {
              ... on PullRequest {
                number
                title
                state
                headRefName
                url
              }
            }
          }
        }
      }
    }
  }
}
`;
