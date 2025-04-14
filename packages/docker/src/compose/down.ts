import { $, chalk, within } from "zx";
import * as compose from "docker-compose";
import { config } from "../config";

$.cwd = config.root;

within(async () => {
  await compose.downAll({
    log: true,
    commandOptions: ["--rmi", "local"],
  });
  console.log(chalk.green("Down complete"));
});
