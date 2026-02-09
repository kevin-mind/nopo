/**
 * Validate @more/issue-state against real GitHub issues.
 * Saves parsed data as JSON files for inspection.
 *
 * Usage: npx tsx validate-parse-issue.ts
 */

import { z } from "zod";
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseIssue,
  serializeMarkdown,
  IssueStateDataSchema,
} from "@more/issue-state";
import type { OctokitLike } from "@more/issue-state";

const __dirname = dirname(fileURLToPath(import.meta.url));

function createOctokit(token: string): OctokitLike {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- read-only mock implementing OctokitLike interface partially
  return {
    async graphql<T>(
      query: string,
      variables?: Record<string, unknown>,
    ): Promise<T> {
      const res = await fetch("https://api.github.com/graphql", {
        method: "POST",
        headers,
        body: JSON.stringify({ query, variables }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`GraphQL request failed (${res.status}): ${text}`);
      }
      const json = z
        .object({ data: z.unknown(), errors: z.array(z.unknown()).optional() })
        .parse(await res.json());
      if (json.errors) {
        throw new Error(
          `GraphQL errors: ${JSON.stringify(json.errors, null, 2)}`,
        );
      }
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- GraphQL response data typed via generic
      return json.data as T;
    },
    rest: {
      issues: {
        async update() {
          throw new Error("read-only");
        },
        async addLabels() {
          throw new Error("read-only");
        },
        async removeLabel() {
          throw new Error("read-only");
        },
        async createComment() {
          throw new Error("read-only");
        },
        async addAssignees() {
          throw new Error("read-only");
        },
        async removeAssignees() {
          throw new Error("read-only");
        },
      },
      pulls: {
        async list() {
          throw new Error("read-only");
        },
        async create() {
          throw new Error("read-only");
        },
        async requestReviewers() {
          throw new Error("read-only");
        },
        async createReview() {
          throw new Error("read-only");
        },
      },
    },
  } as unknown as OctokitLike;
}

const ISSUES_TO_TEST = [
  { number: 4545, description: "Parent with 4 sub-issues + project fields" },
  { number: 4603, description: "Sub-issue (Phase 1) with parent" },
  { number: 4691, description: "Recent triaged issue with labels" },
];

const outDir = join(__dirname, "issue-snapshots");

async function main() {
  const token = execSync("gh auth token", { encoding: "utf-8" }).trim();
  const octokit = createOctokit(token);

  mkdirSync(outDir, { recursive: true });

  for (const { number, description } of ISSUES_TO_TEST) {
    console.log(`Parsing #${number} (${description})...`);

    const { data } = await parseIssue("kevin-mind", "nopo", number, {
      octokit,
      projectNumber: 1,
      fetchPRs: true,
      fetchParent: true,
    });

    const result = IssueStateDataSchema.safeParse(data);
    if (!result.success) {
      console.log(`  VALIDATION FAILED`);
      for (const err of result.error.errors) {
        console.log(`    ${err.path.join(".")} — ${err.message}`);
      }
      continue;
    }

    // Log the serialized body to verify AST round-trip
    const bodyMarkdown = serializeMarkdown(data.issue.bodyAst);
    console.log(`  bodyAst children: ${data.issue.bodyAst.children.length}`);
    console.log(`  serialized body length: ${bodyMarkdown.length}`);

    const file = join(outDir, `issue-${number}.json`);
    writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
    console.log(`  OK → ${file}`);
  }

  console.log(`\nDone. Files in ${outDir}`);
}

main().catch(console.error);
