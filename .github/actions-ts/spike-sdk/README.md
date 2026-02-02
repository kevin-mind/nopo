# SDK V2 Spike - Results

Minimal spike to validate Agent SDK requirements before migrating the GitHub Actions executor.

## Test Results (2026-02-02)

| Requirement | Status | Notes |
|-------------|--------|-------|
| Streaming output | ✅ PASS | Real-time streaming works with V2 API |
| Structured output | ✅ PASS | **V1 API only** - V2 doesn't return `structured_output` yet |
| Sub-agents | ✅ PASS | Task tool invokes agents correctly |
| Slash commands | ✅ PASS | 9 commands found via `settingSources: ['project']` |
| Permission mode | ✅ PASS | `acceptEdits` auto-approves file edits |
| Working directory | ✅ PASS | `cwd` option works correctly |
| Allowed tools | ✅ PASS | Tool restriction works |
| CLAUDE.md loading | ✅ PASS | `settingSources: ['project']` loads project instructions |

## Key Findings

### Use V1 API for Structured Output

The V2 `unstable_v2_createSession()` doesn't include `structured_output` in the result message.
Use V1 `query()` for structured output:

```typescript
// V1 API - structured output WORKS
import { query } from "@anthropic-ai/claude-agent-sdk";

const q = query({
  prompt: "Your prompt",
  options: {
    model: "claude-sonnet-4-5-20250929",
    permissionMode: "acceptEdits",
    outputFormat: {
      type: "json_schema",
      schema: yourSchema,
    },
  },
});

for await (const msg of q) {
  if (msg.type === "result" && msg.subtype === "success") {
    console.log(msg.structured_output); // ✅ Available in V1
  }
}
```

### Sub-agents Use Built-in Types

Custom agents defined via `agents` option are available, but Claude may choose built-in agents (Explore, etc.) if they're more appropriate:

```typescript
const session = unstable_v2_createSession({
  agents: {
    "my-agent": {
      description: "Use for X tasks",
      tools: ["Read", "Glob"],
      prompt: "System prompt",
      model: "haiku",
    },
  },
});
```

### Slash Commands Require Settings Source

To get slash commands, must include `settingSources: ['project']`:

```typescript
const session = unstable_v2_createSession({
  settingSources: ["project"],
  systemPrompt: { type: "preset", preset: "claude_code" },
  cwd: projectRoot,
});
```

## Migration Recommendation

**Use V1 API (`query()`)** for the GitHub Actions executor:

1. Structured output is required for triage/iterate responses
2. V1 has feature parity with CLI
3. V2 is preview/unstable

### Implementation Pattern

```typescript
import { query, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";

export async function executeRunClaude(
  action: RunClaudeAction,
  ctx: RunnerContext,
): Promise<ClaudeRunResult> {
  const { prompt, outputSchema } = getPromptFromAction(action);
  const cwd = action.worktree || process.cwd();

  const options: Options = {
    cwd,
    permissionMode: "acceptEdits",
    allowedTools: action.allowedTools || [
      "Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebSearch", "WebFetch"
    ],
    settingSources: ["project"],
    systemPrompt: { type: "preset", preset: "claude_code" },
  };

  // Structured output mode
  if (outputSchema) {
    options.outputFormat = {
      type: "json_schema",
      schema: JSON.parse(outputSchema),
    };
  }

  let output = "";
  let structuredOutput: unknown;

  const q = query({ prompt, options });

  for await (const msg of q) {
    if (msg.type === "system" && msg.subtype === "init") {
      core.info(`Session: ${msg.session_id}, Model: ${msg.model}`);
    }

    if (msg.type === "assistant") {
      for (const block of msg.message.content) {
        if (block.type === "text") {
          process.stdout.write(block.text);
          output += block.text;
        } else if (block.type === "tool_use") {
          core.info(`[Tool: ${block.name}]`);
        }
      }
    }

    if (msg.type === "result") {
      if (msg.subtype === "success") {
        structuredOutput = msg.structured_output;
        core.info(`Done (${msg.num_turns} turns, $${msg.total_cost_usd.toFixed(4)})`);
      } else {
        return { success: false, exitCode: 1, output, error: msg.errors?.join("\n") };
      }
    }
  }

  return { success: true, exitCode: 0, output, structuredOutput };
}
```

## Run Tests

```bash
cd .github/actions-ts/spike-sdk
pnpm install --ignore-workspace

# Individual tests
npx tsx test-basic.ts           # V2 streaming
npx tsx test-structured-v1.ts   # V1 structured output (PASS)
npx tsx test-structured.ts      # V2 structured output (no structured_output)
npx tsx test-subagent.ts        # Sub-agents
npx tsx test-slash-commands.ts  # Slash commands
```

## Files

- `test-basic.ts` - Basic V2 streaming
- `test-structured.ts` - V2 structured output (doesn't work)
- `test-structured-v1.ts` - V1 structured output (works!)
- `test-subagent.ts` - Custom agent definitions
- `test-slash-commands.ts` - Slash commands via settings
- `test-all.ts` - Comprehensive test (uses V2)
