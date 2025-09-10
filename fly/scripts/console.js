#!/usr/bin/env node

import { z } from "zod";
import { spawn } from "node:child_process";

const env = z
  .object({
    app: z.string(),
    user: z.string().optional(),
    command: z.string().optional(),
  })
  .parse(process.env);

const flyctl = "flyctl";
const args = [
  "console",
  "--app",
  env.app,
  ...(env.user ? ["--user", env.user] : []),
  ...(env.command ? ["-C", `"${env.command}"`] : []),
  "--debug",
  "--verbose",
];

console.log(`$ ${[flyctl, ...args].join(" ")}`);

spawn(flyctl, args, { stdio: "inherit" }).on("close", (code) => {
  console.log("[shell] terminated :", code);
  process.exit(code || 0);
});
