import { z } from "zod";

export const TodoItemSchema = z.object({
  text: z.string(),
  checked: z.boolean(),
  isManual: z.boolean(),
});

export type TodoItem = z.infer<typeof TodoItemSchema>;

export const TodoStatsSchema = z.object({
  total: z.number().int().min(0),
  completed: z.number().int().min(0),
  uncheckedNonManual: z.number().int().min(0),
});

export type TodoStats = z.infer<typeof TodoStatsSchema>;

export const HistoryEntrySchema = z.object({
  iteration: z.number().int().min(0),
  phase: z.string(),
  action: z.string(),
  timestamp: z.string().nullable(),
  sha: z.string().nullable(),
  runLink: z.string().nullable(),
});

export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;

export const AgentNotesEntrySchema = z.object({
  runId: z.string(),
  runLink: z.string(),
  timestamp: z.string(),
  notes: z.array(z.string()),
});

export type AgentNotesEntry = z.infer<typeof AgentNotesEntrySchema>;

export const SectionSchema = z.object({
  name: z.string(),
  content: z.string(),
});

export type Section = z.infer<typeof SectionSchema>;

export const TableSchema = z.object({
  headers: z.array(z.string()),
  rows: z.array(z.record(z.string())),
});

export type Table = z.infer<typeof TableSchema>;
