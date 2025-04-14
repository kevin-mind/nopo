import { $, chalk, within } from "zx";
import * as compose from "docker-compose";
import { config } from "../config";

$.cwd = config.root;

within(async () => {
  await compose.buildAll({
    log: true,
  });
  console.log(chalk.green("Build complete"));
});
