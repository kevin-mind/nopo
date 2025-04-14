import { $, chalk, within } from "zx";
import * as compose from "docker-compose";
import { config } from "./config";

$.cwd = config.root;

within(async () => {
  await compose.run("web", ["npm", "i"], {
    log: true,
    commandOptions: ["--rm", "--remove-orphans"],
  });
  console.log(chalk.green("Setup complete"));
});
