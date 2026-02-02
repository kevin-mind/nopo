/**
 * Test 1: Basic streaming output
 *
 * Validates:
 * - Session creation with V2 API
 * - Streaming messages (system.init, assistant, result)
 * - acceptEdits permission mode
 * - Real-time output
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
  console.log("Test: Basic Streaming Output");
  console.log("============================\n");

  await using session = unstable_v2_createSession({
    model: "claude-sonnet-4-5-20250929",
    permissionMode: "acceptEdits",
    allowedTools: ["Read", "Glob"],
    cwd: process.cwd(),
  });

  console.log("Session created, sending prompt...\n");

  await session.send(
    "What files are in the current directory? List just the first 5.",
  );

  console.log("Streaming response:\n");

  for await (const msg of session.stream()) {
    if (msg.type === "system" && msg.subtype === "init") {
      console.log("[INIT]");
      console.log("  Session ID:", msg.session_id);
      console.log("  Model:", msg.model);
      console.log("  Permission Mode:", msg.permissionMode);
      console.log("  Tools:", msg.tools.slice(0, 5).join(", "), "...");
      console.log(
        "  Slash Commands:",
        msg.slash_commands?.length || 0,
        "available",
      );
      console.log("");
    }

    if (msg.type === "assistant") {
      const text = extractText(msg);
      if (text) {
        process.stdout.write(text);
      }
      // Log tool uses
      for (const block of msg.message.content) {
        if (block.type === "tool_use") {
          console.log(`\n[Tool: ${block.name}]`);
        }
      }
    }

    if (msg.type === "result") {
      console.log("\n\n[RESULT]");
      console.log("  Subtype:", msg.subtype);
      if (msg.subtype === "success") {
        console.log("  Turns:", msg.num_turns);
        console.log("  Cost: $" + msg.total_cost_usd.toFixed(4));
      }
    }
  }

  console.log("\n\n✅ Basic streaming test complete");
}

main().catch((error) => {
  console.error("❌ Test failed:", error);
  process.exit(1);
});
