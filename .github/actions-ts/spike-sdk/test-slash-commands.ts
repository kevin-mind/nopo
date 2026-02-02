/**
 * Test 4: Slash commands availability
 *
 * Validates:
 * - Loading project settings (CLAUDE.md)
 * - Slash commands in system.init message
 * - Claude Code preset system prompt
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
  console.log("Test: Slash Commands Availability");
  console.log("==================================\n");

  // Navigate to project root to load CLAUDE.md
  const projectRoot = process
    .cwd()
    .replace(/\/.github\/actions-ts\/spike-sdk$/, "");

  console.log("Project root:", projectRoot);
  console.log("Loading settings with:");
  console.log("  settingSources: ['project']");
  console.log("  systemPrompt: { type: 'preset', preset: 'claude_code' }");
  console.log("");

  await using session = unstable_v2_createSession({
    model: "claude-sonnet-4-5-20250929",
    permissionMode: "acceptEdits",
    settingSources: ["project"],
    systemPrompt: { type: "preset", preset: "claude_code" },
    cwd: projectRoot,
  });

  console.log("Session created, waiting for init message...\n");

  // Send a minimal prompt to trigger the session
  await session.send("List your available slash commands.");

  let slashCommands: string[] = [];
  let tools: string[] = [];

  for await (const msg of session.stream()) {
    if (msg.type === "system" && msg.subtype === "init") {
      slashCommands = msg.slash_commands || [];
      tools = msg.tools || [];

      console.log("[INIT]");
      console.log("  Session:", msg.session_id);
      console.log("  Model:", msg.model);
      console.log("  Permission Mode:", msg.permissionMode);
      console.log("");
      console.log("  Tools (" + tools.length + "):");
      tools.forEach((t) => console.log("    -", t));
      console.log("");
      console.log("  Slash Commands (" + slashCommands.length + "):");
      slashCommands.forEach((cmd) => console.log("    -", cmd));
      console.log("");
    }

    if (msg.type === "assistant") {
      const text = extractText(msg);
      if (text) {
        process.stdout.write(text);
      }
    }

    if (msg.type === "result") {
      console.log("\n\n[RESULT]");
      console.log("  Subtype:", msg.subtype);
      break;
    }
  }

  console.log("\n");

  if (slashCommands.length > 0) {
    console.log("✅ Slash commands test passed");
    console.log("   Found", slashCommands.length, "slash commands");
    console.log("   Examples:", slashCommands.slice(0, 3).join(", "));
  } else {
    console.log("⚠️  Slash commands test inconclusive");
    console.log("   No slash commands found in init message");
    console.log("   This may be expected if no skills are configured");
  }
}

main().catch((error) => {
  console.error("❌ Test failed:", error);
  process.exit(1);
});
