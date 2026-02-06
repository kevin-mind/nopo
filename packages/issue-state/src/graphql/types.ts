/**
 * Hand-typed GraphQL response interfaces.
 * These mirror the shape of GitHub's GraphQL API responses.
 */

export interface ProjectFieldValue {
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

export interface IssueBodyResponse {
  repository?: {
    issue?: {
      id?: string;
      body?: string;
      parent?: {
        number?: number;
      };
    };
  };
}

export interface PRNode {
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

export interface PRIdResponse {
  repository?: {
    pullRequest?: {
      id?: string;
    };
  };
}

export interface BranchResponse {
  repository?: {
    ref?: { name?: string } | null;
  };
}

export interface RepoIdResponse {
  repository?: {
    id?: string;
  };
}

export interface CreateIssueResponse {
  createIssue?: {
    issue?: {
      id?: string;
      number?: number;
    };
  };
}

export interface ProjectQueryResponse {
  repository?: {
    issue?: {
      id?: string;
      projectItems?: { nodes?: ProjectItemNode[] };
    };
  };
  organization?: {
    projectV2?: {
      id?: string;
      fields?: {
        nodes?: Array<{
          id?: string;
          name?: string;
          options?: Array<{ id: string; name: string }>;
          dataType?: string;
        }>;
      };
    };
  };
}
