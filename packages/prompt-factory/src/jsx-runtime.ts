type Child = string | number | boolean | null | undefined | Child[];

function flattenChildren(children: Child | Child[]): string[] {
  if (children == null || children === false || children === true) return [];
  if (typeof children === "number") return [String(children)];
  if (typeof children === "string") return [children];
  if (Array.isArray(children)) return children.flatMap(flattenChildren);
  return [];
}

type IntrinsicHandler = (
  props: Record<string, unknown>,
  children: string[],
) => string;

function formatAttrs(props: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(props)) {
    if (value != null) parts.push(`${key}="${String(value)}"`);
  }
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

const intrinsics: Record<string, IntrinsicHandler> = {
  prompt: (_props, children) => children.join("\n\n"),
  section: (props, children) =>
    `<section${formatAttrs(props)}>\n${children.join("\n")}\n</section>`,
  codeblock: (props, children) =>
    `\`\`\`${(props.lang as string) ?? ""}\n${children.join("\n")}\n\`\`\``,
  line: (_props, children) => children.join(" "),
};

interface Props {
  children?: Child | Child[];
  [key: string]: unknown;
}

type Component = (props: Props) => string;

function render(type: string | Component, props: Props): string {
  const { children: rawChildren, ...rest } = props;
  const children = flattenChildren(rawChildren);

  if (typeof type === "function") {
    return type(props);
  }

  const handler = intrinsics[type];
  if (handler) {
    return handler(rest, children);
  }

  throw new Error(`Unknown JSX element: <${type}>`);
}

export function jsx(type: string | Component, props: Props): string {
  return render(type, props);
}

export function jsxs(type: string | Component, props: Props): string {
  return render(type, props);
}

// Dev runtime uses jsxDEV instead of jsx/jsxs
export function jsxDEV(type: string | Component, props: Props): string {
  return render(type, props);
}

export function Fragment({ children }: Props): string {
  return flattenChildren(children).join("\n");
}

// eslint-disable-next-line @typescript-eslint/no-namespace -- Required by TypeScript JSX transform
export declare namespace JSX {
  type Element = string;
  interface IntrinsicElements {
    prompt: { children?: Child | Child[] };
    section: { title: string; children?: Child | Child[] };
    codeblock: { lang?: string; children?: Child | Child[] };
    line: { children?: Child | Child[] };
  }
}
