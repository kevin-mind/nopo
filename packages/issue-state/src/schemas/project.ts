import { z } from "zod";
import { ProjectStatusSchema } from "./enums.js";

export const ProjectFieldsSchema = z.object({
  status: ProjectStatusSchema.nullable(),
  iteration: z.number().int().min(0),
  failures: z.number().int().min(0),
});

export type ProjectFields = z.infer<typeof ProjectFieldsSchema>;
