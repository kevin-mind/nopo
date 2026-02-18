import type {
  ExampleContext,
  ExampleProjectStatus,
  IssueStateRepository,
} from "./context.js";

class InMemoryIssueStateRepository implements IssueStateRepository {
  constructor(private readonly context: ExampleContext) {}

  setIssueStatus(status: ExampleProjectStatus): void {
    this.context.issue.projectStatus = status;
  }

  addIssueLabels(labels: string[]): void {
    const merged = [...new Set([...this.context.issue.labels, ...labels])];
    this.context.issue.labels = merged;
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
}

function repositoryFor(context: ExampleContext): IssueStateRepository {
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

export function reconcileSubIssues(
  context: ExampleContext,
  subIssueNumbers: number[],
): void {
  repositoryFor(context).reconcileSubIssues(subIssueNumbers);
}

export async function persistIssueState(
  context: ExampleContext,
): Promise<boolean> {
  const repository = context.repository;
  if (!isPersistableRepository(repository)) return true;
  return repository.save();
}
