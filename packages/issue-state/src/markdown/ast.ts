import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkStringify from "remark-stringify";
import type { Root } from "mdast";

const parser = unified().use(remarkParse).use(remarkGfm);

const serializer = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkStringify, {
    bullet: "-",
    listItemIndent: "one",
  });

export function parseMarkdown(markdown: string): Root {
  return parser.parse(markdown);
}

export function serializeMarkdown(ast: Root): string {
  return serializer.stringify(ast);
}
