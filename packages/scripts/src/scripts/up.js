import compose from "docker-compose";

import { parseEnv } from "../parse-env.js";

export default async function main(config) {
  const env = parseEnv(config.envFile);
  const promises = [];

  const {
    data: {
      config: { services },
    },
  } = await compose.config({
    cwd: config.cwd,
    env: {
      ...process.env,
      ...env,
    },
  });
  const remoteServices = [];
  const localServices = [];

  for (let [name, service] of Object.entries(services)) {
    if (service.image === env.DOCKER_TAG) {
      localServices.push(name);
    } else {
      remoteServices.push(name);
    }
  }

  if (!env.DOCKER_REGISTRY) {
    promises.push(
      compose.buildOne("base", {
        log: true,
        env: {
          ...process.env,
          ...env,
          COMPOSE_BAKE: true,
        },
      }),
    );
  } else {
    promises.push(
      compose.pullOne("base", {
        log: true,
      }),
    );
  }

  promises.push(compose.pullMany(remoteServices, { log: true }));

  const results = await Promise.allSettled(promises);

  for (const result of results) {
    if (result.status === "rejected") {
      throw new Error(result.reason.err);
    }
  }

  await compose.downMany(localServices, {
    log: true,
    commandOptions: ["--remove-orphans"],
  });
  await compose.upAll({
    log: true,
    commandOptions: ["--remove-orphans", "-d"],
  });
  await compose.rm({
    log: true,
    commandOptions: ["--force"],
  });
}
