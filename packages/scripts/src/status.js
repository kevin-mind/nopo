import { $ } from "zx";

export default async function main() {
  console.log(
    Object.entries({
      platform: `${process.platform} ${process.arch}\n`,
      node: await $`node --version`.text(),
      pnpm: await $`pnpm --version`.text(),
    })
      .map(([key, value]) => `${key}: ${value}`)
      .join(""),
  );
}
