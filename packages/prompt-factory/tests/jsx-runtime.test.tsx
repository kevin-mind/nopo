import { describe, it, expect } from "vitest";
import { Fragment } from "../src/jsx-runtime.js";

describe("jsx-runtime", () => {
  describe("intrinsic elements", () => {
    it("renders <prompt> joining children with double newlines", () => {
      const result = (
        <prompt>
          {"First section"}
          {"Second section"}
        </prompt>
      );
      expect(result).toBe("First section\n\nSecond section");
    });

    it("renders <section> with title and children as XML tags", () => {
      const result = <section title="My Title">{"Content here"}</section>;
      expect(result).toBe(
        '<section title="My Title">\nContent here\n</section>',
      );
    });

    it("renders <section> with multiple children joined by newlines", () => {
      const result = (
        <section title="Steps">
          {"Line one"}
          {"Line two"}
        </section>
      );
      expect(result).toBe(
        '<section title="Steps">\nLine one\nLine two\n</section>',
      );
    });

    it("renders <codeblock> with language", () => {
      const result = <codeblock lang="bash">{"git status"}</codeblock>;
      expect(result).toBe("```bash\ngit status\n```");
    });

    it("renders <codeblock> without language", () => {
      const result = <codeblock>{"some code"}</codeblock>;
      expect(result).toBe("```\nsome code\n```");
    });

    it("renders <line> joining children with spaces", () => {
      const result = (
        <line>
          {"hello"}
          {"world"}
        </line>
      );
      expect(result).toBe("hello world");
    });
  });

  describe("function components", () => {
    it("calls function component with props", () => {
      function Greeting({ name }: { name: string }) {
        return `Hello, ${name}!`;
      }
      const result = <Greeting name="World" />;
      expect(result).toBe("Hello, World!");
    });

    it("passes children to function components", () => {
      function Wrapper({ children }: { children?: string }) {
        return `[${children}]`;
      }
      const result = <Wrapper>{"inner"}</Wrapper>;
      expect(result).toBe("[inner]");
    });
  });

  describe("children handling", () => {
    it("filters out null children", () => {
      const result = (
        <prompt>
          {"visible"}
          {null}
          {"also visible"}
        </prompt>
      );
      expect(result).toBe("visible\n\nalso visible");
    });

    it("filters out undefined children", () => {
      const result = (
        <prompt>
          {"visible"}
          {undefined}
          {"also visible"}
        </prompt>
      );
      expect(result).toBe("visible\n\nalso visible");
    });

    it("filters out false children", () => {
      const result = (
        <prompt>
          {"visible"}
          {false}
          {"also visible"}
        </prompt>
      );
      expect(result).toBe("visible\n\nalso visible");
    });

    it("converts numbers to strings", () => {
      const result = <line>{42}</line>;
      expect(result).toBe("42");
    });

    it("flattens array children", () => {
      const items = ["a", "b", "c"];
      const result = <prompt>{items}</prompt>;
      expect(result).toBe("a\n\nb\n\nc");
    });
  });

  describe("Fragment", () => {
    it("joins children with newlines", () => {
      const result = (
        <Fragment>
          {"line one"}
          {"line two"}
        </Fragment>
      );
      expect(result).toBe("line one\nline two");
    });
  });

  describe("nested elements", () => {
    it("composes nested intrinsic elements", () => {
      const result = (
        <prompt>
          <section title="Overview">{"This is a test"}</section>
          <section title="Code">
            <codeblock lang="ts">{"const x = 1;"}</codeblock>
          </section>
        </prompt>
      );
      expect(result).toBe(
        '<section title="Overview">\nThis is a test\n</section>\n\n<section title="Code">\n```ts\nconst x = 1;\n```\n</section>',
      );
    });

    it("composes function components with intrinsic elements", () => {
      function Header({ text }: { text: string }) {
        return `# ${text}`;
      }
      const result = (
        <prompt>
          <Header text="My Doc" />
          <section title="Body">{"Content"}</section>
        </prompt>
      );
      expect(result).toBe(
        '# My Doc\n\n<section title="Body">\nContent\n</section>',
      );
    });
  });
});
