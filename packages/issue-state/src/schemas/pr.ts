import { z } from "zod";
import { PRStateSchema, CIStatusSchema } from "./enums.js";

export const LinkedPRSchema = z.object({
  number: z.number().int().positive(),
  state: PRStateSchema,
  isDraft: z.boolean(),
  title: z.string(),
  headRef: z.string(),
  baseRef: z.string(),
  ciStatus: CIStatusSchema.nullable().optional(),
});

export type LinkedPR = z.infer<typeof LinkedPRSchema>;
