import { z } from "zod";
import { IssueDataSchema } from "./issue.js";

export const IssueStateDataSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  issue: IssueDataSchema,
  parentIssue: IssueDataSchema.nullable(),
});

export type IssueStateData = z.infer<typeof IssueStateDataSchema>;
