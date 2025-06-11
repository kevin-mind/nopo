import type { Config } from "@react-router/dev/config";

import env from "./env";

export default {
  ssr: true,
  basename: env.SERVICE_PUBLIC_PATH,
} satisfies Config;
