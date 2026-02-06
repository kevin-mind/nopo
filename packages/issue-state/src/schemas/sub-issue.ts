import { z } from "zod";
import { IssueStateSchema, ProjectStatusSchema } from "./enums.js";
import { TodoStatsSchema, SectionSchema } from "./markdown.js";
import { LinkedPRSchema } from "./pr.js";

export const SubIssueDataSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  state: IssueStateSchema,
  body: z.string(),
  projectStatus: ProjectStatusSchema.nullable(),
  branch: z.string().nullable(),
  pr: LinkedPRSchema.nullable(),
  description: z.string().nullable(),
  todos: z.array(
    z.lazy(() =>
      z.object({
        text: z.string(),
        checked: z.boolean(),
        isManual: z.boolean(),
      }),
    ),
  ),
  todoStats: TodoStatsSchema,
  sections: z.array(SectionSchema),
});

export type SubIssueData = z.infer<typeof SubIssueDataSchema>;
