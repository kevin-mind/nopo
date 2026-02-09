/**
 * Minimal Octokit-like interface.
 *
 * The consumer passes their already-constructed Octokit instance.
 * This avoids a hard dependency on @actions/github or @octokit/rest.
 */

interface RestIssues {
  update(params: {
    owner: string;
    repo: string;
    issue_number: number;
    body?: string;
    state?: string;
    state_reason?: string;
    title?: string;
  }): Promise<unknown>;
  addLabels(params: {
    owner: string;
    repo: string;
    issue_number: number;
    labels: string[];
  }): Promise<unknown>;
  removeLabel(params: {
    owner: string;
    repo: string;
    issue_number: number;
    name: string;
  }): Promise<unknown>;
  setLabels(params: {
    owner: string;
    repo: string;
    issue_number: number;
    labels: string[];
  }): Promise<unknown>;
  createComment(params: {
    owner: string;
    repo: string;
    issue_number: number;
    body: string;
  }): Promise<{ data: { id: number } }>;
  updateComment(params: {
    owner: string;
    repo: string;
    comment_id: number;
    body: string;
  }): Promise<unknown>;
  listComments(params: {
    owner: string;
    repo: string;
    issue_number: number;
    per_page?: number;
  }): Promise<{
    data: Array<{
      id: number;
      body?: string;
      user?: { login?: string } | null;
      created_at: string;
    }>;
  }>;
  listForRepo(params: {
    owner: string;
    repo: string;
    labels?: string;
    state?: string;
    per_page?: number;
  }): Promise<{
    data: Array<{
      number: number;
      title: string;
      state: string;
      body?: string | null;
    }>;
  }>;
  addAssignees(params: {
    owner: string;
    repo: string;
    issue_number: number;
    assignees: string[];
  }): Promise<unknown>;
  removeAssignees(params: {
    owner: string;
    repo: string;
    issue_number: number;
    assignees: string[];
  }): Promise<unknown>;
}

interface RestPulls {
  list(params: {
    owner: string;
    repo: string;
    head?: string;
    base?: string;
    state?: string;
  }): Promise<{ data: Array<{ number: number }> }>;
  create(params: {
    owner: string;
    repo: string;
    title: string;
    body: string;
    head: string;
    base: string;
    draft?: boolean;
  }): Promise<{ data: { number: number } }>;
  requestReviewers(params: {
    owner: string;
    repo: string;
    pull_number: number;
    reviewers: string[];
  }): Promise<unknown>;
  createReview(params: {
    owner: string;
    repo: string;
    pull_number: number;
    event: string;
    body: string;
  }): Promise<unknown>;
}

export interface OctokitLike {
  graphql: <T>(
    query: string,
    variables?: Record<string, unknown>,
  ) => Promise<T>;
  rest: {
    issues: RestIssues;
    pulls: RestPulls;
  };
}
