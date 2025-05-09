import compose from "docker-compose";

export default async function main(config) {
  const composeConfig = await compose.config({
    cwd: config.root,
  });

  const baseImage = composeConfig?.data?.config?.services?.base?.image ?? null;

  console.log({ baseImage });
}
