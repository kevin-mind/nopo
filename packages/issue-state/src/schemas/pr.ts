import { z } from "zod";
import {
  PRStateSchema,
  CIStatusSchema,
  ReviewDecisionSchema,
  MergeableStateSchema,
} from "./enums.js";

export const LinkedPRSchema = z.object({
  number: z.number().int().positive(),
  state: PRStateSchema,
  isDraft: z.boolean(),
  title: z.string(),
  headRef: z.string(),
  baseRef: z.string(),
  ciStatus: CIStatusSchema.nullable().optional(),
  reviewDecision: ReviewDecisionSchema.nullable().optional(),
  mergeable: MergeableStateSchema.nullable().optional(),
  reviewCount: z.number().int().nonnegative().optional(),
  url: z.string().optional(),
  author: z.string().nullable().optional(),
  labels: z.array(z.string()).default([]),
  reviews: z
    .array(
      z.object({
        state: z.string(),
        author: z.string(),
        body: z.string(),
      }),
    )
    .default([]),
});

export type LinkedPR = z.infer<typeof LinkedPRSchema>;
