import { z } from "zod";

export const IssueCommentSchema = z.object({
  id: z.string(),
  databaseId: z.number().optional(),
  author: z.string(),
  body: z.string(),
  createdAt: z.string(),
  isBot: z.boolean(),
});

export type IssueComment = z.infer<typeof IssueCommentSchema>;
