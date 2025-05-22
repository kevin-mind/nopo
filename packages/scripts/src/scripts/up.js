import compose from "docker-compose";

export default async function main(config) {
  const { data } = await compose.config({
    cwd: config.cwd,
    env: {
      ...process.env,
      ...config.env.data,
    },
  });
  const localServices = Object.entries(data.config.services)
    .filter(([, service]) => service.image === config.env.DOCKER_TAG)
    .map(([name]) => name);

  await compose.downMany(localServices, {
    log: true,
    commandOptions: ["--remove-orphans"],
  });
  await compose.upAll({
    log: true,
    commandOptions: ["--remove-orphans", "-d", "--no-build"],
  });
  await compose.rm({
    log: true,
    commandOptions: ["--force"],
  });
}
