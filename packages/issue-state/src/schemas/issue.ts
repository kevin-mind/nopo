import { z } from "zod";
import { IssueStateSchema, ProjectStatusSchema } from "./enums.js";
import {
  TodoStatsSchema,
  HistoryEntrySchema,
  AgentNotesEntrySchema,
  SectionSchema,
  TodoItemSchema,
} from "./markdown.js";
import { IssueCommentSchema } from "./comment.js";
import { LinkedPRSchema } from "./pr.js";
import { SubIssueDataSchema } from "./sub-issue.js";

export const IssueDataSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  state: IssueStateSchema,
  body: z.string(),
  projectStatus: ProjectStatusSchema.nullable(),
  iteration: z.number().int().min(0),
  failures: z.number().int().min(0),
  assignees: z.array(z.string()),
  labels: z.array(z.string()),
  subIssues: z.array(SubIssueDataSchema),
  hasSubIssues: z.boolean(),
  description: z.string().nullable(),
  approach: z.string().nullable(),
  todos: z.array(TodoItemSchema),
  todoStats: TodoStatsSchema,
  history: z.array(HistoryEntrySchema),
  agentNotes: z.array(AgentNotesEntrySchema).default([]),
  sections: z.array(SectionSchema),
  comments: z.array(IssueCommentSchema).default([]),
  branch: z.string().nullable(),
  pr: LinkedPRSchema.nullable(),
  parentIssueNumber: z.number().int().positive().nullable(),
});

export type IssueData = z.infer<typeof IssueDataSchema>;
