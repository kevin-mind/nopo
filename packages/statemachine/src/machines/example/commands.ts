import type {
  ExampleContext,
  ExampleProjectStatus,
  IssueStateRepository,
} from "./context.js";

class InMemoryIssueStateRepository implements IssueStateRepository {
  private nextIssueNumber = 1000;

  constructor(private readonly context: ExampleContext) {}

  setIssueStatus(status: ExampleProjectStatus): void {
    this.context.issue.projectStatus = status;
  }

  addIssueLabels(labels: string[]): void {
    const merged = [...new Set([...this.context.issue.labels, ...labels])];
    this.context.issue.labels = merged;
  }

  removeIssueLabels(labels: string[]): void {
    this.context.issue.labels = this.context.issue.labels.filter(
      (l) => !labels.some((r) => r.toLowerCase() === l.toLowerCase()),
    );
  }

  reconcileSubIssues(subIssueNumbers: number[]): void {
    const byNumber = new Map(
      this.context.issue.subIssues.map((subIssue) => [
        subIssue.number,
        subIssue,
      ]),
    );
    this.context.issue.subIssues = subIssueNumbers.map((number) => {
      const existing = byNumber.get(number);
      return {
        number,
        projectStatus: existing?.projectStatus ?? "Backlog",
        state: existing?.state ?? "OPEN",
      };
    });
    this.context.issue.hasSubIssues = this.context.issue.subIssues.length > 0;
  }

  async createSubIssue(_input: {
    title: string;
    body?: string;
    labels?: string[];
  }): Promise<{ issueNumber: number }> {
    const issueNumber = this.nextIssueNumber++;
    this.context.issue.subIssues.push({
      number: issueNumber,
      projectStatus: "Backlog",
      state: "OPEN",
    });
    this.context.issue.hasSubIssues = true;
    return { issueNumber };
  }

  updateBody(body: string): void {
    this.context.issue.body = body;
  }

  appendHistoryEntry(entry: {
    phase: string;
    message: string;
    timestamp?: string;
    sha?: string;
    runLink?: string;
  }): void {
    // In-memory: append a simple text representation to body
    const issue = this.context.issue;
    if (!issue.body.includes("## Iteration History")) {
      issue.body += `\n\n## Iteration History\n\n| Time | # | Phase | Action | SHA | Run |\n|---|---|---|---|---|---|\n`;
    }
    issue.body += `| ${entry.timestamp ?? "-"} | - | ${entry.phase} | ${entry.message} | ${entry.sha ?? "-"} | ${entry.runLink ?? "-"} |\n`;
  }

  async markPRReady(_prNumber: number): Promise<void> {
    if (this.context.pr) {
      this.context.pr.isDraft = false;
    }
  }

  async requestReviewer(_prNumber: number, _reviewer: string): Promise<void> {
    // In-memory: no-op
  }

  async assignBotToSubIssue(
    _subIssueNumber: number,
    _botUsername: string,
  ): Promise<void> {
    // In-memory: no-op (no real GitHub API to call)
  }

  async updateSubIssueProjectStatus(
    subIssueNumber: number,
    status: ExampleProjectStatus,
  ): Promise<void> {
    const sub = this.context.issue.subIssues.find(
      (s) => s.number === subIssueNumber,
    );
    if (sub) sub.projectStatus = status;
    if (this.context.currentSubIssue?.number === subIssueNumber) {
      this.context.currentSubIssue.projectStatus = status;
    }
  }
}

export function repositoryFor(context: ExampleContext): IssueStateRepository {
  return context.repository ?? new InMemoryIssueStateRepository(context);
}

function isPersistableRepository(
  value: unknown,
): value is IssueStateRepository & { save: () => Promise<boolean> } {
  if (value == null || typeof value !== "object") return false;
  const save = Reflect.get(value, "save");
  return typeof save === "function";
}

export function setIssueStatus(
  context: ExampleContext,
  status: ExampleProjectStatus,
): void {
  repositoryFor(context).setIssueStatus(status);
}

export function applyTriage(
  context: ExampleContext,
  labelsToAdd: string[],
): void {
  repositoryFor(context).addIssueLabels(labelsToAdd);
}

export function applyGrooming(
  context: ExampleContext,
  labelsToAdd: string[],
): void {
  repositoryFor(context).addIssueLabels(labelsToAdd);
}

export function removeIssueLabels(
  context: ExampleContext,
  labels: string[],
): void {
  const repo = repositoryFor(context);
  if (repo.removeIssueLabels) {
    repo.removeIssueLabels(labels);
  }
}

export function reconcileSubIssues(
  context: ExampleContext,
  subIssueNumbers: number[],
): void {
  repositoryFor(context).reconcileSubIssues(subIssueNumbers);
}

export async function markPRReady(
  context: ExampleContext,
  prNumber: number,
): Promise<void> {
  await repositoryFor(context).markPRReady?.(prNumber);
}

export async function requestReviewer(
  context: ExampleContext,
  prNumber: number,
  reviewer: string,
): Promise<void> {
  await repositoryFor(context).requestReviewer?.(prNumber, reviewer);
}

export async function persistIssueState(
  context: ExampleContext,
): Promise<boolean> {
  const repository = context.repository;
  if (!isPersistableRepository(repository)) return true;
  return repository.save();
}
