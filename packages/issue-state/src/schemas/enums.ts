import { z } from "zod";

/**
 * Project field values for Status single-select field.
 *
 * Parent issues use: Backlog, In progress, Done, Blocked, Error
 * Sub-issues use: Ready, In progress, In review, Done
 */
export const ProjectStatusSchema = z.enum([
  "Backlog",
  "In progress",
  "Ready",
  "In review",
  "Done",
  "Blocked",
  "Error",
]);

export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const IssueStateSchema = z.enum(["OPEN", "CLOSED"]);

export type IssueState = z.infer<typeof IssueStateSchema>;

export const PRStateSchema = z.enum(["OPEN", "CLOSED", "MERGED"]);

export type PRState = z.infer<typeof PRStateSchema>;

export const CIStatusSchema = z.enum([
  "SUCCESS",
  "FAILURE",
  "PENDING",
  "ERROR",
  "EXPECTED",
]);

export type CIStatus = z.infer<typeof CIStatusSchema>;
