/**
 * Test SDK in GitHub Actions-like environment
 *
 * Mimics GHA by:
 * - Setting CI=true
 * - No TTY
 * - Using environment-based auth (ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN)
 * - Testing all requirements in one run
 */

import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";

// ============================================================================
// Utilities
// ============================================================================

function log(msg: string): void {
  // Mimic @actions/core.info
  console.log(msg);
}

function logGroup(title: string): void {
  console.log(`::group::${title}`);
}

function logEndGroup(): void {
  console.log("::endgroup::");
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
// Test 1: Basic Streaming with V1 query()
// ============================================================================

async function testBasicStreaming(): Promise<boolean> {
  logGroup("Test 1: Basic Streaming (V1 API)");

  try {
    const q = query({
      prompt: "What is 2 + 2? Answer briefly.",
      options: {
        model: "claude-sonnet-4-5-20250929",
        permissionMode: "acceptEdits",
        maxTurns: 1,
      },
    });

    let gotInit = false;
    let gotAssistant = false;
    let gotResult = false;

    for await (const msg of q) {
      if (msg.type === "system" && msg.subtype === "init") {
        gotInit = true;
        log(`[INIT] Session: ${msg.session_id}`);
        log(`[INIT] Model: ${msg.model}`);
        log(`[INIT] PermissionMode: ${msg.permissionMode}`);
      }

      if (msg.type === "assistant") {
        gotAssistant = true;
        const text = extractText(msg);
        if (text) {
          process.stdout.write(text);
        }
      }

      if (msg.type === "result") {
        gotResult = true;
        log(`\n[RESULT] ${msg.subtype}`);
        if (msg.subtype === "success") {
          log(`[RESULT] Cost: $${msg.total_cost_usd.toFixed(4)}`);
        }
      }
    }

    const passed = gotInit && gotAssistant && gotResult;
    log(passed ? "\n✅ Basic streaming: PASS" : "\n❌ Basic streaming: FAIL");
    logEndGroup();
    return passed;
  } catch (error) {
    log(`\n❌ Basic streaming: ERROR - ${error}`);
    logEndGroup();
    return false;
  }
}

// ============================================================================
// Test 2: Structured Output
// ============================================================================

async function testStructuredOutput(): Promise<boolean> {
  logGroup("Test 2: Structured Output (JSON Schema)");

  const schema = {
    type: "object",
    properties: {
      answer: { type: "number" },
      explanation: { type: "string" },
    },
    required: ["answer", "explanation"],
  };

  log(`[SCHEMA] ${JSON.stringify(schema)}`);

  try {
    // Note: Do NOT set maxTurns when using structured output
    // The agent needs multiple turns to process and generate structured output
    const q = query({
      prompt:
        "What is 15 * 7? Provide the numerical answer and a brief explanation.",
      options: {
        model: "claude-sonnet-4-5-20250929",
        permissionMode: "acceptEdits",
        // No maxTurns - let it complete naturally
        outputFormat: {
          type: "json_schema",
          schema,
        },
      },
    });

    let structuredOutput: unknown = null;
    let resultKeys: string[] = [];

    for await (const msg of q) {
      if (msg.type === "system" && msg.subtype === "init") {
        log(`[INIT] Session: ${msg.session_id}`);
      }

      if (msg.type === "assistant") {
        const text = extractText(msg);
        if (text) process.stdout.write(text);
      }

      if (msg.type === "result") {
        resultKeys = Object.keys(msg);
        log(`\n[RESULT] subtype: ${msg.subtype}`);
        log(`[RESULT] keys: ${resultKeys.join(", ")}`);

        if (msg.subtype === "success") {
          structuredOutput = msg.structured_output;
          log(`[RESULT] Cost: $${msg.total_cost_usd.toFixed(4)}`);
          log(`[RESULT] structured_output type: ${typeof structuredOutput}`);
          log(
            `[RESULT] structured_output: ${JSON.stringify(structuredOutput)}`,
          );
        } else {
          // Log error details
          const errorMsg = msg as { errors?: string[] };
          log(`[RESULT] errors: ${errorMsg.errors?.join(", ") || "none"}`);
        }
      }
    }

    const output = structuredOutput as {
      answer?: number;
      explanation?: string;
    } | null;
    const passed =
      output !== null &&
      output !== undefined &&
      typeof output?.answer === "number" &&
      typeof output?.explanation === "string";

    log(
      passed ? "\n✅ Structured output: PASS" : "\n❌ Structured output: FAIL",
    );
    if (!passed && structuredOutput === undefined) {
      log(
        "   Note: structured_output was undefined - SDK may not support this feature",
      );
    }
    logEndGroup();
    return passed;
  } catch (error) {
    log(`\n❌ Structured output: ERROR - ${error}`);
    logEndGroup();
    return false;
  }
}

// ============================================================================
// Test 3: Tool Use (Glob)
// ============================================================================

async function testToolUse(): Promise<boolean> {
  logGroup("Test 3: Tool Use (Glob)");

  try {
    const q = query({
      prompt:
        "Use the Glob tool to find all .ts files in the current directory. List them.",
      options: {
        model: "claude-sonnet-4-5-20250929",
        permissionMode: "acceptEdits",
        allowedTools: ["Glob"],
        cwd: process.cwd(),
      },
    });

    let toolUsed = false;

    for await (const msg of q) {
      if (msg.type === "assistant") {
        const text = extractText(msg);
        if (text) process.stdout.write(text);

        for (const block of msg.message.content) {
          if (block.type === "tool_use") {
            toolUsed = true;
            log(`\n[TOOL] ${block.name}`);
          }
        }
      }

      if (msg.type === "result") {
        log(`\n[RESULT] ${msg.subtype}`);
      }
    }

    log(
      toolUsed
        ? "\n✅ Tool use: PASS"
        : "\n❌ Tool use: FAIL (no tool invoked)",
    );
    logEndGroup();
    return toolUsed;
  } catch (error) {
    log(`\n❌ Tool use: ERROR - ${error}`);
    logEndGroup();
    return false;
  }
}

// ============================================================================
// Test 4: Permission Mode (acceptEdits)
// ============================================================================

async function testPermissionMode(): Promise<boolean> {
  logGroup("Test 4: Permission Mode (acceptEdits)");

  try {
    const q = query({
      prompt: "List the permission mode you're running with.",
      options: {
        model: "claude-sonnet-4-5-20250929",
        permissionMode: "acceptEdits",
        maxTurns: 1,
      },
    });

    let permissionMode = "";

    for await (const msg of q) {
      if (msg.type === "system" && msg.subtype === "init") {
        permissionMode = msg.permissionMode;
        log(`[INIT] Permission mode: ${permissionMode}`);
      }

      if (msg.type === "assistant") {
        const text = extractText(msg);
        if (text) process.stdout.write(text);
      }

      if (msg.type === "result") {
        log(`\n[RESULT] ${msg.subtype}`);
      }
    }

    const passed = permissionMode === "acceptEdits";
    log(passed ? "\n✅ Permission mode: PASS" : "\n❌ Permission mode: FAIL");
    logEndGroup();
    return passed;
  } catch (error) {
    log(`\n❌ Permission mode: ERROR - ${error}`);
    logEndGroup();
    return false;
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log("=".repeat(60));
  console.log("SDK Spike - GitHub Actions Environment Test");
  console.log("=".repeat(60));
  console.log(`CI: ${process.env.CI || "false"}`);
  console.log(`TTY: ${process.stdout.isTTY || false}`);

  // Auth detection - prefer OAuth (Max subscription) over API key
  // Obfuscate tokens for security
  const obfuscate = (token: string | undefined) => {
    if (!token) return null;
    if (token.length <= 12) return "***";
    return token.slice(0, 8) + "..." + token.slice(-4);
  };

  const oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  const apiKey = process.env.ANTHROPIC_API_KEY;

  const authMethod = oauthToken
    ? `OAUTH_TOKEN (Max subscription) ${obfuscate(oauthToken)}`
    : apiKey
      ? `API_KEY (API billing) ${obfuscate(apiKey)}`
      : "CLI_AUTH (local)";
  console.log(`Auth: ${authMethod}`);
  console.log(`CWD: ${process.cwd()}`);
  console.log("=".repeat(60));
  console.log("");

  const results: boolean[] = [];

  results.push(await testBasicStreaming());
  results.push(await testStructuredOutput());
  results.push(await testToolUse());
  results.push(await testPermissionMode());

  console.log("");
  console.log("=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));

  const passed = results.filter(Boolean).length;
  const total = results.length;

  console.log(`Passed: ${passed}/${total}`);

  if (passed === total) {
    console.log("\n✅ All tests passed! SDK is ready for GHA migration.");
    process.exit(0);
  } else {
    console.log("\n❌ Some tests failed. Review before migrating.");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
