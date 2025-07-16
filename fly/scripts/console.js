#!/usr/bin/env zx

import { z } from "zod";
import { $ } from "zx";
import { spawn } from "node:child_process";

$.verbose = true;

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

console.log([flyctl, ...args].join(" "));

spawn(flyctl, args, { stdio: "inherit" }).on("close", (code) => {
  console.log("[shell] terminated :", code);
});
