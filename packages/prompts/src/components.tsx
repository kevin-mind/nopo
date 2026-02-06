import { Conditional, BulletList } from "@more/prompt-factory";

/** Standard issue header used across multiple prompts */
export function IssueHeader({
  number,
  title,
}: {
  number: number;
  title: string;
}) {
  return <line>{`Implement issue #${number}: "${title}"`}</line>;
}

/** Agent notes section - only renders if notes exist */
export function AgentNotes({ notes }: { notes: string }) {
  return (
    <Conditional when={notes}>
      <section title="Previous Agent Notes">{notes}</section>
    </Conditional>
  );
}

/** Standard issue state display (iteration, CI, branch) */
export function IssueState(props: {
  iteration: number;
  lastCiResult: string;
  consecutiveFailures: number;
  branchName: string;
  parentContext?: string;
}) {
  return (
    <section title="Current State">
      <BulletList
        items={[
          `**Iteration**: ${props.iteration}`,
          `**Previous CI Result**: ${props.lastCiResult}`,
          `**Consecutive Failures**: ${props.consecutiveFailures}`,
          `**Branch**: \`${props.branchName}\``,
          ...(props.parentContext ? [props.parentContext] : []),
        ]}
      />
    </section>
  );
}
