import { describe, it, expect } from "vitest";
import { parseTable, serializeTable } from "../../src/markdown/tables.js";

const SAMPLE_TABLE = `| Name | Age | City |
|---|---|---|
| Alice | 30 | NYC |
| Bob | 25 | LA |`;

describe("parseTable", () => {
  it("parses a markdown table", () => {
    const result = parseTable(SAMPLE_TABLE);
    expect(result).not.toBeNull();
    expect(result!.headers).toEqual(["Name", "Age", "City"]);
    expect(result!.rows).toHaveLength(2);
    expect(result!.rows[0]).toEqual({ Name: "Alice", Age: "30", City: "NYC" });
    expect(result!.rows[1]).toEqual({ Name: "Bob", Age: "25", City: "LA" });
  });

  it("returns null for non-table input", () => {
    expect(parseTable("Just text\nMore text")).toBeNull();
  });

  it("handles table with surrounding text", () => {
    const input = `Some text before

| A | B |
|---|---|
| 1 | 2 |

Some text after`;

    const result = parseTable(input);
    expect(result).not.toBeNull();
    expect(result!.headers).toEqual(["A", "B"]);
    expect(result!.rows).toHaveLength(1);
  });
});

describe("serializeTable", () => {
  it("serializes back to markdown", () => {
    const table = {
      headers: ["Name", "Age"],
      rows: [
        { Name: "Alice", Age: "30" },
        { Name: "Bob", Age: "25" },
      ],
    };

    const result = serializeTable(table);
    expect(result).toContain("| Name | Age |");
    expect(result).toContain("|---|---|");
    expect(result).toContain("| Alice | 30 |");
    expect(result).toContain("| Bob | 25 |");
  });

  it("uses dash for missing values", () => {
    const table = {
      headers: ["A", "B"],
      rows: [{ A: "1" }],
    };

    const result = serializeTable(table);
    expect(result).toContain("| 1 | - |");
  });
});

describe("round-trip", () => {
  it("parse -> serialize -> parse produces same data", () => {
    const result1 = parseTable(SAMPLE_TABLE);
    expect(result1).not.toBeNull();
    const serialized = serializeTable(result1!);
    const result2 = parseTable(serialized);
    expect(result2!.headers).toEqual(result1!.headers);
    expect(result2!.rows).toEqual(result1!.rows);
  });
});
