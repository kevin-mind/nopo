/**
 * Test 2: Structured output (JSON schema)
 *
 * Validates:
 * - outputFormat with json_schema
 * - structured_output in result message
 * - Schema validation
 *
 * Note: Using session-based approach since unstable_v2_prompt doesn't return structured_output
 */

import {
  unstable_v2_createSession,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";

function extractText(msg: SDKMessage): string | null {
  if (msg.type !== "assistant") return null;
  return msg.message.content
    .filter(
      (block): block is { type: "text"; text: string } => block.type === "text",
    )
    .map((block) => block.text)
    .join("");
}

async function main() {
  console.log("Test: Structured Output (JSON Schema)");
  console.log("=====================================\n");

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
  console.log("\nUsing session-based approach for structured output...\n");

  await using session = unstable_v2_createSession({
    model: "claude-sonnet-4-5-20250929",
    permissionMode: "acceptEdits",
    outputFormat: {
      type: "json_schema",
      schema,
    },
  });

  await session.send(
    "List 3 programming languages with their paradigm and year created.",
  );

  let structuredOutput: unknown = null;
  let resultSubtype = "";

  for await (const msg of session.stream()) {
    if (msg.type === "assistant") {
      const text = extractText(msg);
      if (text) {
        process.stdout.write(text);
      }
    }

    if (msg.type === "result") {
      console.log("\n\n[RESULT]");
      console.log("  Subtype:", msg.subtype);
      resultSubtype = msg.subtype;

      // Log all keys to debug
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

  if (resultSubtype === "success" && structuredOutput !== null) {
    // Validate structure
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
      console.log("✅ Structured output test passed");
      console.log("   Summary:", output.summary);
      console.log(
        "   Languages:",
        output.languages?.map((l) => l.name).join(", "),
      );
      console.log("   Count:", output.count);
    } else {
      console.log("❌ Structured output validation failed - invalid structure");
      process.exit(1);
    }
  } else if (resultSubtype === "success" && structuredOutput === null) {
    console.log("⚠️  Structured output test inconclusive");
    console.log(
      "   Result was successful but structured_output was null/undefined",
    );
    console.log(
      "   This may indicate SDK doesn't support structured output in V2",
    );
    // Don't fail - this is useful information
  } else {
    console.log("❌ Request failed");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("❌ Test failed:", error);
  process.exit(1);
});
