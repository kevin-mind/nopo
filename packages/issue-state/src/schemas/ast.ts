import { z } from "zod";
import type { Root } from "mdast";

const MdastNodeSchema: z.ZodType<Record<string, unknown>> = z.lazy(() =>
  z
    .object({
      type: z.string(),
      children: z.array(MdastNodeSchema).optional(),
    })
    .passthrough(),
);

export const MdastRootSchema: z.ZodType<Root> = z
  .object({
    type: z.literal("root"),
    children: z.array(MdastNodeSchema),
  })
  .passthrough() as unknown as z.ZodType<Root>;
