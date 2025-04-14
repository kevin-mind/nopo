import { $, chalk, within } from "zx";
import * as compose from "docker-compose";
import { config } from "../config";

$.cwd = config.root;

within(async () => {
  console.log(chalk.green("Starting compose"));
  await compose
    .upAll({
      log: true,
      commandOptions: ["--build", "--remove-orphans"],
    })
    .catch((err) => {
      console.error(chalk.red(err.err));
      throw err;
    });
  console.log(chalk.green("Up complete"));
});
