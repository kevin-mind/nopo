/** Wraps content in a <purpose> tag describing the prompt's goal */
export function Purpose({ children }: { children?: string }) {
  return `<purpose>\n${children ?? ""}\n</purpose>`;
}

/** Wraps content in a <background> tag for contextual info */
export function Background({ children }: { children?: string }) {
  return `<background>\n${children ?? ""}\n</background>`;
}

/** Wraps items in <instructions> with each item in an <instruction> tag */
export function Instructions({
  items,
  children,
}: {
  items?: string[];
  children?: string;
}) {
  const rendered = (items ?? [])
    .map((item) => `<instruction>${item}</instruction>`)
    .join("\n");
  const parts = [rendered, children].filter(Boolean).join("\n");
  return `<instructions>\n${parts}\n</instructions>`;
}

/** Renders a single <instruction> tag */
export function Instruction({ children }: { children?: string }) {
  return `<instruction>${children ?? ""}</instruction>`;
}

/** Wraps content in a <user-input> tag for the user's raw input */
export function UserInput({ children }: { children?: string }) {
  return `<user-input>\n${children ?? ""}\n</user-input>`;
}

/** Renders a single <example> tag, optionally with input/output sub-tags */
export function Example({
  children,
  input,
  output,
}: {
  children?: string;
  input?: string;
  output?: string;
}) {
  if (input != null || output != null) {
    const parts: string[] = [];
    if (input != null) parts.push(`<input>\n${input}\n</input>`);
    if (output != null) parts.push(`<output>\n${output}\n</output>`);
    return `<example>\n${parts.join("\n")}\n</example>`;
  }
  return `<example>\n${children ?? ""}\n</example>`;
}

/** Wraps items in <examples> with each item in an <example> tag */
export function Examples({
  items,
  children,
}: {
  items?: string[];
  children?: string;
}) {
  const rendered = (items ?? [])
    .map((item) => `<example>\n${item}\n</example>`)
    .join("\n");
  const parts = [rendered, children].filter(Boolean).join("\n");
  return `<examples>\n${parts}\n</examples>`;
}

/** Wraps content in a <data> tag with optional title */
export function Data({
  title,
  format,
  children,
}: {
  title?: string;
  format?: string;
  children?: string;
}) {
  const attrs: string[] = [];
  if (title) attrs.push(`title="${title}"`);
  if (format) attrs.push(`format="${format}"`);
  const attrStr = attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
  return `<data${attrStr}>\n${children ?? ""}\n</data>`;
}

/** Wraps content in an <output-format> tag describing desired response shape */
export function OutputFormat({
  title,
  format,
  children,
}: {
  title?: string;
  format?: string;
  children?: string;
}) {
  const attrs: string[] = [];
  if (title) attrs.push(`title="${title}"`);
  if (format) attrs.push(`format="${format}"`);
  const attrStr = attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
  return `<output-format${attrStr}>\n${children ?? ""}\n</output-format>`;
}

/** Renders a <chat-history> with <message> sub-tags */
export function ChatHistory({
  messages,
}: {
  messages: { role: string; content: string }[];
}) {
  const rendered = messages
    .map((m) => `<message role="${m.role}">\n${m.content}\n</message>`)
    .join("\n");
  return `<chat-history>\n${rendered}\n</chat-history>`;
}

/** Wraps content in a <priority> tag for emphasis */
export function Priority({ children }: { children?: string }) {
  return `<priority>\n${children ?? ""}\n</priority>`;
}

/** Renders items as a bullet list (utility, no XML tag) */
export function BulletList({ items }: { items: string[] }) {
  return items.map((item) => `- ${item}`).join("\n");
}

/** Only renders children when `when` is truthy (utility, no XML tag) */
export function Conditional({
  when,
  children,
}: {
  when: unknown;
  children?: string;
}) {
  return when ? (children ?? "") : "";
}
