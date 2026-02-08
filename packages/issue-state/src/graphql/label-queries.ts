/**
 * GraphQL queries and mutations for GitHub Labels
 */

export const GET_LABEL_IDS_QUERY = `
query GetLabelIds($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    labels(first: 100) {
      nodes {
        id
        name
      }
    }
  }
}
`;

export const ADD_LABELS_MUTATION = `
mutation AddLabelsToLabelable($labelableId: ID!, $labelIds: [ID!]!) {
  addLabelsToLabelable(input: { labelableId: $labelableId, labelIds: $labelIds }) {
    labelable {
      __typename
    }
  }
}
`;
