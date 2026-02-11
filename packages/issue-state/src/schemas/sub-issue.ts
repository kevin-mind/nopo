import { z } from "zod";
import { IssueStateSchema, ProjectStatusSchema } from "./enums.js";
import { MdastRootSchema } from "./ast.js";
import { LinkedPRSchema } from "./pr.js";

export const SubIssueDataSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  state: IssueStateSchema,
  bodyAst: MdastRootSchema,
  projectStatus: ProjectStatusSchema.nullable(),
  labels: z.array(z.string()),
  branch: z.string().nullable(),
  pr: LinkedPRSchema.nullable(),
});

export type SubIssueData = z.infer<typeof SubIssueDataSchema>;
