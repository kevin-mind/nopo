import { describe, it, expect } from "vitest";
import {
  Purpose,
  Background,
  Instructions,
  Instruction,
  UserInput,
  Example,
  Examples,
  Data,
  OutputFormat,
  ChatHistory,
  Priority,
  BulletList,
  Conditional,
} from "../src/components.js";

describe("components", () => {
  describe("Purpose", () => {
    it("wraps content in <purpose> tags", () => {
      const result = <Purpose>{"Analyze user data"}</Purpose>;
      expect(result).toBe("<purpose>\nAnalyze user data\n</purpose>");
    });
  });

  describe("Background", () => {
    it("wraps content in <background> tags", () => {
      const result = <Background>{"Some context here"}</Background>;
      expect(result).toBe("<background>\nSome context here\n</background>");
    });
  });

  describe("Instructions", () => {
    it("renders items as <instruction> tags inside <instructions>", () => {
      const result = <Instructions items={["Be concise", "Use examples"]} />;
      expect(result).toBe(
        "<instructions>\n<instruction>Be concise</instruction>\n<instruction>Use examples</instruction>\n</instructions>",
      );
    });

    it("renders children alongside items", () => {
      const result = (
        <Instructions items={["First"]}>
          <Instruction>{"Second"}</Instruction>
        </Instructions>
      );
      expect(result).toBe(
        "<instructions>\n<instruction>First</instruction>\n<instruction>Second</instruction>\n</instructions>",
      );
    });

    it("renders children only when no items", () => {
      const result = (
        <Instructions>
          <Instruction>{"Only child"}</Instruction>
        </Instructions>
      );
      expect(result).toBe(
        "<instructions>\n<instruction>Only child</instruction>\n</instructions>",
      );
    });

    it("handles empty", () => {
      const result = <Instructions />;
      expect(result).toBe("<instructions>\n\n</instructions>");
    });
  });

  describe("Instruction", () => {
    it("renders a single <instruction> tag", () => {
      const result = <Instruction>{"Do this"}</Instruction>;
      expect(result).toBe("<instruction>Do this</instruction>");
    });
  });

  describe("UserInput", () => {
    it("wraps content in <user-input> tags", () => {
      const result = <UserInput>{"Hello world"}</UserInput>;
      expect(result).toBe("<user-input>\nHello world\n</user-input>");
    });
  });

  describe("Example", () => {
    it("wraps children in <example> tags", () => {
      const result = <Example>{"A sample response"}</Example>;
      expect(result).toBe("<example>\nA sample response\n</example>");
    });

    it("renders input/output sub-tags when provided", () => {
      const result = <Example input="question" output="answer" />;
      expect(result).toBe(
        "<example>\n<input>\nquestion\n</input>\n<output>\nanswer\n</output>\n</example>",
      );
    });

    it("renders input only", () => {
      const result = <Example input="just input" />;
      expect(result).toBe(
        "<example>\n<input>\njust input\n</input>\n</example>",
      );
    });
  });

  describe("Examples", () => {
    it("wraps items in <examples> with <example> sub-tags", () => {
      const result = <Examples items={["First example", "Second example"]} />;
      expect(result).toBe(
        "<examples>\n<example>\nFirst example\n</example>\n<example>\nSecond example\n</example>\n</examples>",
      );
    });

    it("renders children alongside items", () => {
      const result = (
        <Examples items={["From array"]}>
          <Example>{"From child"}</Example>
        </Examples>
      );
      expect(result).toBe(
        "<examples>\n<example>\nFrom array\n</example>\n<example>\nFrom child\n</example>\n</examples>",
      );
    });
  });

  describe("Data", () => {
    it("wraps content in <data> tags", () => {
      const result = <Data>{'{"key": "value"}'}</Data>;
      expect(result).toBe('<data>\n{"key": "value"}\n</data>');
    });

    it("includes title attribute", () => {
      const result = <Data title="Config">{"content"}</Data>;
      expect(result).toBe('<data title="Config">\ncontent\n</data>');
    });

    it("includes format attribute", () => {
      const result = <Data format="json">{"content"}</Data>;
      expect(result).toBe('<data format="json">\ncontent\n</data>');
    });

    it("includes both attributes", () => {
      const result = (
        <Data title="Config" format="yaml">
          {"content"}
        </Data>
      );
      expect(result).toBe(
        '<data title="Config" format="yaml">\ncontent\n</data>',
      );
    });
  });

  describe("OutputFormat", () => {
    it("wraps content in <output-format> tags", () => {
      const result = <OutputFormat>{"Respond in JSON"}</OutputFormat>;
      expect(result).toBe("<output-format>\nRespond in JSON\n</output-format>");
    });

    it("includes title and format attributes", () => {
      const result = (
        <OutputFormat title="Response" format="JSON">
          {"Include a summary field"}
        </OutputFormat>
      );
      expect(result).toBe(
        '<output-format title="Response" format="JSON">\nInclude a summary field\n</output-format>',
      );
    });
  });

  describe("ChatHistory", () => {
    it("renders messages as <message> tags inside <chat-history>", () => {
      const result = (
        <ChatHistory
          messages={[
            { role: "user", content: "Hello" },
            { role: "assistant", content: "Hi there" },
          ]}
        />
      );
      expect(result).toBe(
        '<chat-history>\n<message role="user">\nHello\n</message>\n<message role="assistant">\nHi there\n</message>\n</chat-history>',
      );
    });

    it("handles empty messages", () => {
      const result = <ChatHistory messages={[]} />;
      expect(result).toBe("<chat-history>\n\n</chat-history>");
    });
  });

  describe("Priority", () => {
    it("wraps content in <priority> tags", () => {
      const result = <Priority>{"Do this first"}</Priority>;
      expect(result).toBe("<priority>\nDo this first\n</priority>");
    });
  });

  describe("BulletList", () => {
    it("renders a bullet list", () => {
      const result = <BulletList items={["first", "second", "third"]} />;
      expect(result).toBe("- first\n- second\n- third");
    });
  });

  describe("Conditional", () => {
    it("renders children when condition is truthy", () => {
      const result = <Conditional when={true}>{"visible"}</Conditional>;
      expect(result).toBe("visible");
    });

    it("renders empty string when condition is falsy", () => {
      const result = <Conditional when={false}>{"hidden"}</Conditional>;
      expect(result).toBe("");
    });

    it("renders empty string when condition is null", () => {
      const result = <Conditional when={null}>{"hidden"}</Conditional>;
      expect(result).toBe("");
    });

    it("renders empty string when condition is empty string", () => {
      const result = <Conditional when={""}>{"hidden"}</Conditional>;
      expect(result).toBe("");
    });

    it("renders with truthy non-boolean values", () => {
      const result = <Conditional when="some text">{"visible"}</Conditional>;
      expect(result).toBe("visible");
    });

    it("renders empty string when children are undefined", () => {
      const result = <Conditional when={true} />;
      expect(result).toBe("");
    });
  });

  describe("composition", () => {
    it("components compose inside <prompt>", () => {
      const result = (
        <prompt>
          <Purpose>{"Help the user"}</Purpose>
          <Instructions items={["Be kind", "Be clear"]} />
        </prompt>
      );
      expect(result).toContain("<purpose>");
      expect(result).toContain("<instructions>");
      expect(result).toContain("<instruction>Be kind</instruction>");
    });
  });
});
