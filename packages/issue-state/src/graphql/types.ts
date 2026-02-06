/**
 * Hand-typed GraphQL response interfaces.
 * These mirror the shape of GitHub's GraphQL API responses.
 */

interface ProjectFieldValue {
  name?: string;
  number?: number;
  field?: { name?: string; id?: string };
}

export interface ProjectItemNode {
  id?: string;
  project?: { id?: string; number?: number };
  fieldValues?: { nodes?: ProjectFieldValue[] };
}

export interface SubIssueNode {
  id?: string;
  number?: number;
  title?: string;
  body?: string;
  state?: string;
  projectItems?: { nodes?: ProjectItemNode[] };
}

export interface IssueCommentNode {
  id?: string;
  author?: { login?: string };
  body?: string;
  createdAt?: string;
}

export interface IssueResponse {
  repository?: {
    issue?: {
      id?: string;
      number?: number;
      title?: string;
      body?: string;
      state?: string;
      assignees?: { nodes?: Array<{ login?: string }> };
      labels?: { nodes?: Array<{ name?: string }> };
      parent?: { number?: number } | null;
      projectItems?: { nodes?: ProjectItemNode[] };
      subIssues?: { nodes?: SubIssueNode[] };
      comments?: { nodes?: IssueCommentNode[] };
    };
  };
}

interface PRNode {
  number?: number;
  title?: string;
  state?: string;
  isDraft?: boolean;
  headRefName?: string;
  baseRefName?: string;
  commits?: {
    nodes?: Array<{
      commit?: {
        statusCheckRollup?: {
          state?: string;
        };
      };
    }>;
  };
}

export interface PRResponse {
  repository?: {
    pullRequests?: {
      nodes?: PRNode[];
    };
  };
}

export interface BranchResponse {
  repository?: {
    ref?: { name?: string } | null;
  };
}
