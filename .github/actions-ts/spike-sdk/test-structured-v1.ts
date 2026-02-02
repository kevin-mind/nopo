/**
 * Test 2b: Structured output using V1 API
 *
 * Testing if structured output works with query() function (V1 API)
 */

import { query } from "@anthropic-ai/claude-agent-sdk";

async function main() {
  console.log("Test: Structured Output (V1 API)");
  console.log("================================\n");

  const schema = {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "Brief summary of the response",
      },
      languages: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            paradigm: { type: "string" },
            year: { type: "number" },
          },
          required: ["name", "paradigm", "year"],
        },
        description: "List of programming languages",
      },
      count: {
        type: "number",
        description: "Number of languages listed",
      },
    },
    required: ["summary", "languages", "count"],
  };

  console.log("Schema:", JSON.stringify(schema, null, 2));
  console.log("\nUsing V1 query() with outputFormat...\n");

  const q = query({
    prompt:
      "List 3 programming languages with their paradigm and year created.",
    options: {
      model: "claude-sonnet-4-5-20250929",
      permissionMode: "acceptEdits",
      outputFormat: {
        type: "json_schema",
        schema,
      },
    },
  });

  let structuredOutput: unknown = null;
  let resultSubtype = "";

  for await (const msg of q) {
    if (msg.type === "assistant") {
      const text = msg.message.content
        .filter(
          (block): block is { type: "text"; text: string } =>
            block.type === "text",
        )
        .map((block) => block.text)
        .join("");
      if (text) {
        process.stdout.write(text);
      }
    }

    if (msg.type === "result") {
      console.log("\n\n[RESULT]");
      console.log("  Subtype:", msg.subtype);
      resultSubtype = msg.subtype;
      console.log("  Keys:", Object.keys(msg).join(", "));

      if (msg.subtype === "success") {
        console.log("  Cost: $" + msg.total_cost_usd.toFixed(4));
        structuredOutput = msg.structured_output;
        console.log(
          "\n  Structured Output:",
          JSON.stringify(structuredOutput, null, 4),
        );
      }
    }
  }

  console.log("\n");

  if (
    resultSubtype === "success" &&
    structuredOutput !== null &&
    structuredOutput !== undefined
  ) {
    const output = structuredOutput as {
      summary?: string;
      languages?: Array<{ name: string; paradigm: string; year: number }>;
      count?: number;
    };

    const isValid =
      typeof output?.summary === "string" &&
      Array.isArray(output?.languages) &&
      typeof output?.count === "number";

    if (isValid) {
      console.log("✅ Structured output test passed (V1 API)");
      console.log("   Summary:", output.summary);
      console.log(
        "   Languages:",
        output.languages?.map((l) => l.name).join(", "),
      );
      console.log("   Count:", output.count);
    } else {
      console.log("❌ Structured output validation failed - invalid structure");
      console.log("   Got:", JSON.stringify(structuredOutput));
      process.exit(1);
    }
  } else {
    console.log("⚠️  Structured output was null/undefined");
    console.log("   This indicates a potential issue with outputFormat");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("❌ Test failed:", error);
  process.exit(1);
});
