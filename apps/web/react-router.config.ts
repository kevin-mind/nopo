import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  basename: process.env.SERVICE_PUBLIC_PATH || "/",
} satisfies Config;
