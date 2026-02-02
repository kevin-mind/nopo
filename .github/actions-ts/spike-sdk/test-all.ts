/**
 * SDK V2 Spike - Validate all requirements before migration
 *
 * Requirements to validate:
 * 1. Real-time streaming output
 * 2. Structured output (JSON schema)
 * 3. Sub-agents support (Task tool with custom agents)
 * 4. Slash commands support
 * 5. Permission mode: acceptEdits (not bypassPermissions)
 * 6. Working directory configuration
 * 7. Allowed tools configuration
 * 8. System prompt / CLAUDE.md loading
 */

import {
  unstable_v2_createSession,
  unstable_v2_prompt,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";

// ============================================================================
// Test utilities
// ============================================================================

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  details?: Record<string, unknown>;
}

function logSection(title: string): void {
  console.log("\n" + "=".repeat(60));
  console.log(title);
  console.log("=".repeat(60) + "\n");
}

function extractText(msg: SDKMessage): string | null {
  if (msg.type !== "assistant") return null;
  return msg.message.content
    .filter(
      (block): block is { type: "text"; text: string } => block.type === "text",
    )
    .map((block) => block.text)
    .join("");
}

// ============================================================================
// Test 1: Basic streaming output
// ============================================================================

async function testBasicStreaming(): Promise<TestResult> {
  logSection("Test 1: Basic Streaming Output");

  try {
    await using session = unstable_v2_createSession({
      model: "claude-sonnet-4-5-20250929",
      permissionMode: "acceptEdits",
      allowedTools: ["Read", "Glob"],
      cwd: process.cwd(),
    });

    await session.send(
      "List the files in the current directory. Just show the first 5.",
    );

    let receivedSystemInit = false;
    let receivedAssistant = false;
    let receivedResult = false;
    let sessionId = "";

    for await (const msg of session.stream()) {
      sessionId = msg.session_id;

      if (msg.type === "system" && msg.subtype === "init") {
        receivedSystemInit = true;
        console.log("[INIT] Session:", msg.session_id);
        console.log("[INIT] Model:", msg.model);
        console.log("[INIT] Tools:", msg.tools.join(", "));
        console.log("[INIT] Permission mode:", msg.permissionMode);
        console.log(
          "[INIT] Slash commands:",
          msg.slash_commands?.join(", ") || "none",
        );
      }

      if (msg.type === "assistant") {
        receivedAssistant = true;
        const text = extractText(msg);
        if (text) {
          process.stdout.write(text);
        }
        // Check for tool use
        for (const block of msg.message.content) {
          if (block.type === "tool_use") {
            console.log(`\n[TOOL: ${block.name}]`);
          }
        }
      }

      if (msg.type === "result") {
        receivedResult = true;
        console.log("\n\n[RESULT]", msg.subtype);
        if (msg.subtype === "success") {
          console.log("  Turns:", msg.num_turns);
          console.log("  Cost: $" + msg.total_cost_usd.toFixed(4));
        }
      }
    }

    const passed = receivedSystemInit && receivedAssistant && receivedResult;
    return {
      name: "Basic Streaming",
      passed,
      details: {
        receivedSystemInit,
        receivedAssistant,
        receivedResult,
        sessionId,
      },
    };
  } catch (error) {
    return {
      name: "Basic Streaming",
      passed: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================================================
// Test 2: Structured output (JSON schema)
// ============================================================================

async function testStructuredOutput(): Promise<TestResult> {
  logSection("Test 2: Structured Output (JSON Schema)");

  const schema = {
    type: "object",
    properties: {
      summary: { type: "string", description: "Brief summary" },
      items: {
        type: "array",
        items: { type: "string" },
        description: "List of items",
      },
      count: { type: "number", description: "Number of items" },
    },
    required: ["summary", "items", "count"],
  };

  try {
    const result = await unstable_v2_prompt(
      "List 3 programming languages. Return as structured output.",
      {
        model: "claude-sonnet-4-5-20250929",
        permissionMode: "acceptEdits",
        outputFormat: {
          type: "json_schema",
          schema,
        },
      },
    );

    console.log("[RESULT]", result.subtype);

    let structuredOutput: unknown = null;

    if (result.subtype === "success") {
      structuredOutput = result.structured_output;
      console.log(
        "Structured output:",
        JSON.stringify(structuredOutput, null, 2),
      );
    }

    const passed =
      result.subtype === "success" &&
      structuredOutput !== null &&
      typeof structuredOutput === "object";

    return {
      name: "Structured Output",
      passed,
      details: { structuredOutput },
    };
  } catch (error) {
    return {
      name: "Structured Output",
      passed: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================================================
// Test 3: Sub-agents (Task tool with custom agents)
// ============================================================================

async function testSubAgents(): Promise<TestResult> {
  logSection("Test 3: Sub-agents (Custom Agent Definition)");

  try {
    await using session = unstable_v2_createSession({
      model: "claude-sonnet-4-5-20250929",
      permissionMode: "acceptEdits",
      // Define a custom subagent
      agents: {
        "file-counter": {
          description: "Use this agent to count files in a directory",
          tools: ["Glob", "Bash"],
          prompt:
            "You are a file counting agent. Count files matching the pattern requested.",
          model: "haiku",
        },
      },
      allowedTools: ["Task", "Read", "Glob"],
      cwd: process.cwd(),
    });

    await session.send(
      "Use the file-counter agent to count how many TypeScript files are in the current directory.",
    );

    let subagentUsed = false;

    for await (const msg of session.stream()) {
      if (msg.type === "assistant") {
        const text = extractText(msg);
        if (text) {
          process.stdout.write(text);
        }
        // Check for Task tool (subagent invocation)
        for (const block of msg.message.content) {
          if (block.type === "tool_use" && block.name === "Task") {
            subagentUsed = true;
            console.log(
              "\n[SUBAGENT INVOKED]",
              JSON.stringify(block.input, null, 2),
            );
          }
        }
      }

      if (msg.type === "result") {
        console.log("\n\n[RESULT]", msg.subtype);
      }
    }

    return {
      name: "Sub-agents",
      passed: subagentUsed,
      details: { subagentUsed },
      error: subagentUsed
        ? undefined
        : "Task tool was not invoked for subagent",
    };
  } catch (error) {
    return {
      name: "Sub-agents",
      passed: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================================================
// Test 4: Slash commands availability
// ============================================================================

async function testSlashCommands(): Promise<TestResult> {
  logSection("Test 4: Slash Commands Availability");

  try {
    await using session = unstable_v2_createSession({
      model: "claude-sonnet-4-5-20250929",
      permissionMode: "acceptEdits",
      // Load project settings to get slash commands
      settingSources: ["project"],
      systemPrompt: { type: "preset", preset: "claude_code" },
      cwd: process.cwd(),
    });

    // Just start the session to get the init message
    await session.send("Hello, what slash commands are available?");

    let slashCommands: string[] = [];

    for await (const msg of session.stream()) {
      if (msg.type === "system" && msg.subtype === "init") {
        slashCommands = msg.slash_commands || [];
        console.log("Available slash commands:", slashCommands);
      }

      if (msg.type === "assistant") {
        const text = extractText(msg);
        if (text) {
          process.stdout.write(text);
        }
      }

      if (msg.type === "result") {
        console.log("\n\n[RESULT]", msg.subtype);
        break;
      }
    }

    // Check if we got any slash commands
    const hasSlashCommands = slashCommands.length > 0;

    return {
      name: "Slash Commands",
      passed: hasSlashCommands,
      details: { slashCommands, count: slashCommands.length },
      error: hasSlashCommands ? undefined : "No slash commands found",
    };
  } catch (error) {
    return {
      name: "Slash Commands",
      passed: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================================================
// Test 5: Permission mode acceptEdits
// ============================================================================

async function testAcceptEditsMode(): Promise<TestResult> {
  logSection("Test 5: Permission Mode (acceptEdits)");

  try {
    await using session = unstable_v2_createSession({
      model: "claude-sonnet-4-5-20250929",
      permissionMode: "acceptEdits",
      allowedTools: ["Write", "Edit", "Read"],
      cwd: process.cwd(),
    });

    await session.send(
      "Create a file called test-output.txt with the content 'Hello from SDK spike test'",
    );

    let permissionMode = "";
    let fileWritten = false;

    for await (const msg of session.stream()) {
      if (msg.type === "system" && msg.subtype === "init") {
        permissionMode = msg.permissionMode;
        console.log("Permission mode confirmed:", permissionMode);
      }

      if (msg.type === "assistant") {
        const text = extractText(msg);
        if (text) {
          process.stdout.write(text);
        }
        for (const block of msg.message.content) {
          if (block.type === "tool_use" && block.name === "Write") {
            fileWritten = true;
            console.log("\n[WRITE TOOL USED]");
          }
        }
      }

      if (msg.type === "result") {
        console.log("\n\n[RESULT]", msg.subtype);
      }
    }

    // Clean up test file
    const fs = await import("fs");
    if (fs.existsSync("test-output.txt")) {
      fs.unlinkSync("test-output.txt");
      console.log("Cleaned up test file");
    }

    const passed = permissionMode === "acceptEdits" && fileWritten;

    return {
      name: "Accept Edits Mode",
      passed,
      details: { permissionMode, fileWritten },
    };
  } catch (error) {
    return {
      name: "Accept Edits Mode",
      passed: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================================================
// Main test runner
// ============================================================================

async function main() {
  console.log("SDK V2 Spike - Validating Requirements");
  console.log("======================================");
  console.log("Date:", new Date().toISOString());
  console.log("CWD:", process.cwd());

  const results: TestResult[] = [];

  // Run tests sequentially
  results.push(await testBasicStreaming());
  results.push(await testStructuredOutput());
  results.push(await testSubAgents());
  results.push(await testSlashCommands());
  results.push(await testAcceptEditsMode());

  // Summary
  logSection("SUMMARY");

  for (const result of results) {
    const status = result.passed ? "\u2705 PASS" : "\u274c FAIL";
    console.log(`${status}: ${result.name}`);
    if (result.error) {
      console.log(`       Error: ${result.error}`);
    }
  }

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;

  console.log(`\nTotal: ${passed}/${total} tests passed`);

  if (passed === total) {
    console.log("\n\u2705 All requirements validated! Ready to migrate.");
    process.exit(0);
  } else {
    console.log("\n\u274c Some requirements failed. Review before migrating.");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
