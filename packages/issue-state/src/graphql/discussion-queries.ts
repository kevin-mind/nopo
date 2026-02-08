/**
 * GraphQL queries and mutations for GitHub Discussions
 */

export const GET_DISCUSSION_ID_QUERY = `
query GetDiscussionId($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    discussion(number: $number) {
      id
    }
  }
}
`;

export const GET_DISCUSSION_QUERY = `
query GetDiscussion($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    discussion(number: $number) {
      id
      number
      title
      body
      comments(first: 50) {
        totalCount
        nodes {
          id
          body
          author {
            login
          }
          replies(first: 20) {
            totalCount
          }
        }
      }
    }
  }
}
`;

export const ADD_DISCUSSION_COMMENT_MUTATION = `
mutation AddDiscussionComment($discussionId: ID!, $body: String!) {
  addDiscussionComment(input: {
    discussionId: $discussionId
    body: $body
  }) {
    comment {
      id
      body
    }
  }
}
`;

export const ADD_DISCUSSION_REPLY_MUTATION = `
mutation AddDiscussionReply($discussionId: ID!, $replyToId: ID!, $body: String!) {
  addDiscussionComment(input: {
    discussionId: $discussionId
    replyToId: $replyToId
    body: $body
  }) {
    comment {
      id
      body
    }
  }
}
`;

export const UPDATE_DISCUSSION_MUTATION = `
mutation UpdateDiscussion($discussionId: ID!, $body: String!) {
  updateDiscussion(input: {
    discussionId: $discussionId
    body: $body
  }) {
    discussion {
      id
      body
    }
  }
}
`;

export const UPDATE_DISCUSSION_COMMENT_MUTATION = `
mutation UpdateDiscussionComment($commentId: ID!, $body: String!) {
  updateDiscussionComment(input: {
    commentId: $commentId
    body: $body
  }) {
    comment {
      id
    }
  }
}
`;

export const ADD_REACTION_MUTATION = `
mutation AddReaction($subjectId: ID!, $content: ReactionContent!) {
  addReaction(input: {
    subjectId: $subjectId
    content: $content
  }) {
    reaction {
      id
      content
    }
  }
}
`;

export const GET_DISCUSSION_LABELS_QUERY = `
query GetDiscussionLabels($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    discussion(number: $number) {
      labels(first: 20) {
        nodes {
          name
        }
      }
    }
  }
}
`;

export const GET_DISCUSSION_CATEGORIES_QUERY = `
query GetDiscussionCategories($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    id
    discussionCategories(first: 25) {
      nodes {
        id
        name
        slug
      }
    }
  }
}
`;

export const CREATE_DISCUSSION_MUTATION = `
mutation CreateDiscussion($repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
  createDiscussion(input: {
    repositoryId: $repositoryId
    categoryId: $categoryId
    title: $title
    body: $body
  }) {
    discussion {
      id
      number
    }
  }
}
`;

export const GET_DISCUSSION_COMMENTS_QUERY = `
query GetDiscussionComments($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    discussion(number: $number) {
      id
      title
      body
      comments(first: 50) {
        nodes {
          id
          author { login }
          body
          replies(first: 20) {
            nodes {
              id
              author { login }
              body
            }
          }
        }
      }
    }
  }
}
`;
