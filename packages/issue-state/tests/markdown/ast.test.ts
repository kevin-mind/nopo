import { describe, it, expect } from "vitest";
import { parseMarkdown, serializeMarkdown } from "../../src/markdown/ast.js";
import { MdastRootSchema } from "../../src/schemas/ast.js";

describe("parseMarkdown", () => {
  it("parses simple paragraph", () => {
    const ast = parseMarkdown("Hello world");
    expect(ast.type).toBe("root");
    expect(ast.children).toHaveLength(1);
    expect(ast.children[0]!.type).toBe("paragraph");
  });

  it("parses headings", () => {
    const ast = parseMarkdown("# Title\n\n## Subtitle\n\nContent");
    expect(ast.children).toHaveLength(3);
    expect(ast.children[0]).toMatchObject({ type: "heading", depth: 1 });
    expect(ast.children[1]).toMatchObject({ type: "heading", depth: 2 });
    expect(ast.children[2]!.type).toBe("paragraph");
  });

  it("parses GFM tables", () => {
    const md = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    const ast = parseMarkdown(md);
    expect(ast.children).toHaveLength(1);
    expect(ast.children[0]!.type).toBe("table");
  });

  it("parses GFM task lists", () => {
    const md = "- [ ] unchecked\n- [x] checked";
    const ast = parseMarkdown(md);
    expect(ast.children).toHaveLength(1);
    const list = ast.children[0]!;
    expect(list.type).toBe("list");
    expect(
      (list as { children: { checked: boolean | null }[] }).children[0]!
        .checked,
    ).toBe(false);
    expect(
      (list as { children: { checked: boolean | null }[] }).children[1]!
        .checked,
    ).toBe(true);
  });

  it("parses code blocks", () => {
    const md = "```typescript\nconst x = 1;\n```";
    const ast = parseMarkdown(md);
    expect(ast.children).toHaveLength(1);
    expect(ast.children[0]).toMatchObject({
      type: "code",
      lang: "typescript",
    });
  });

  it("parses HTML comments", () => {
    const md = "<!-- hidden -->\n\nVisible";
    const ast = parseMarkdown(md);
    const htmlNode = ast.children.find((n) => n.type === "html");
    expect(htmlNode).toBeDefined();
  });

  it("parses empty string", () => {
    const ast = parseMarkdown("");
    expect(ast.type).toBe("root");
    expect(ast.children).toHaveLength(0);
  });
});

describe("serializeMarkdown", () => {
  it("serializes a simple AST back to markdown", () => {
    const ast = parseMarkdown("Hello world");
    const result = serializeMarkdown(ast);
    expect(result.trim()).toBe("Hello world");
  });

  it("round-trips headings and content", () => {
    const md = "# Title\n\n## Subtitle\n\nSome content here.";
    const ast = parseMarkdown(md);
    const result = serializeMarkdown(ast);
    expect(result.trim()).toBe(md);
  });

  it("round-trips GFM tables", () => {
    const md = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    const ast = parseMarkdown(md);
    const result = serializeMarkdown(ast).trim();
    // Table round-trip should preserve structure
    expect(result).toContain("| A | B |");
    expect(result).toContain("| 1 | 2 |");
  });

  it("round-trips task lists", () => {
    const md = "- [ ] unchecked\n- [x] checked";
    const ast = parseMarkdown(md);
    const result = serializeMarkdown(ast).trim();
    expect(result).toContain("[ ] unchecked");
    expect(result).toContain("[x] checked");
  });
});

describe("MdastRootSchema", () => {
  it("validates a parsed AST", () => {
    const ast = parseMarkdown("# Hello\n\nWorld");
    const result = MdastRootSchema.safeParse(ast);
    expect(result.success).toBe(true);
  });

  it("rejects non-root nodes", () => {
    const result = MdastRootSchema.safeParse({
      type: "paragraph",
      children: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing children", () => {
    const result = MdastRootSchema.safeParse({ type: "root" });
    expect(result.success).toBe(false);
  });
});
