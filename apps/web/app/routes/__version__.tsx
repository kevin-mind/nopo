import fs from "node:fs";
import { z } from "zod";

const schema = z.object({
  repo: z.string(),
  branch: z.string(),
  commit: z.string(),
  version: z.string(),
  tag: z.string(),
  build: z.string(),
  target: z.string(),
});

export async function loader() {
  const filePath = "/build-info.json";
  const data = await fs.promises.readFile(filePath, "utf-8");
  const formatted = schema.parse(JSON.parse(data));
  return new Response(JSON.stringify(formatted), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
