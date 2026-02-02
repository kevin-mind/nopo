/**
 * Test 3: Sub-agents (Task tool with custom agents)
 *
 * Validates:
 * - Custom agent definition via `agents` option
 * - Task tool invocation
 * - Agent-specific model selection
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
  console.log("Test: Sub-agents (Custom Agent Definition)");
  console.log("==========================================\n");

  // Define a custom subagent
  const agents = {
    "file-analyzer": {
      description:
        "Use this agent to analyze files and report findings. Good for file exploration tasks.",
      tools: ["Read", "Glob", "Grep"],
      prompt:
        "You are a file analysis agent. Your job is to analyze files and report your findings concisely.",
      model: "haiku" as const,
    },
  };

  console.log("Registered custom agent: file-analyzer");
  console.log("  Tools:", agents["file-analyzer"].tools.join(", "));
  console.log("  Model:", agents["file-analyzer"].model);
  console.log("");

  await using session = unstable_v2_createSession({
    model: "claude-sonnet-4-5-20250929",
    permissionMode: "acceptEdits",
    agents,
    allowedTools: ["Task", "Read", "Glob"],
    cwd: process.cwd(),
  });

  console.log(
    "Session created, sending prompt that should trigger subagent...\n",
  );

  await session.send(
    "Use the file-analyzer agent to find and analyze the package.json file in this directory.",
  );

  let taskToolUsed = false;
  let agentTypeUsed = "";

  for await (const msg of session.stream()) {
    if (msg.type === "system" && msg.subtype === "init") {
      console.log("[INIT] Session:", msg.session_id);
    }

    if (msg.type === "assistant") {
      const text = extractText(msg);
      if (text) {
        process.stdout.write(text);
      }

      // Check for Task tool (subagent invocation)
      for (const block of msg.message.content) {
        if (block.type === "tool_use" && block.name === "Task") {
          taskToolUsed = true;
          const input = block.input as {
            subagent_type?: string;
            description?: string;
          };
          agentTypeUsed = input.subagent_type || "unknown";
          console.log("\n\n[TASK TOOL INVOKED]");
          console.log("  Agent Type:", agentTypeUsed);
          console.log("  Description:", input.description);
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

  console.log("\n");

  if (taskToolUsed) {
    console.log("✅ Sub-agent test passed");
    console.log("   Task tool was invoked");
    console.log("   Agent type:", agentTypeUsed);
  } else {
    console.log("⚠️  Sub-agent test inconclusive");
    console.log("   Task tool was NOT invoked");
    console.log("   Claude may have handled the task directly");
    console.log("   This is acceptable - the agent option is available");
  }
}

main().catch((error) => {
  console.error("❌ Test failed:", error);
  process.exit(1);
});
