import { $ } from "zx";

const stats = {
  platform: `${process.platform} ${process.arch}\n`,
  node: await $`node --version`.text(),
  pnpm: await $`pnpm --version`.text(),
};

console.log(
  Object.entries(stats)
    .map(([key, value]) => `${key}: ${value}`)
    .join(""),
);
