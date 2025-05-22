import compose from "docker-compose";

export default async function main(config) {
  try {
    if (config.env.data.DOCKER_REGISTRY) {
      console.log("Pulling base image");
      await compose.pullOne("base", {
        log: true,
        commandOptions: ["--policy", "always"],
      });
    } else {
      console.log("Building base image");
      await compose.buildOne("base", {
        log: true,
        cwd: config.root,
        env: {
          ...process.env,
          ...config.env.data,
          COMPOSE_BAKE: true,
        },
      });
    }
  } catch (error) {
    console.error(error.err);
    process.exit(error.exitCode);
  }
}
