// import type { StorybookConfig } from "@storybook/web-components-vite";
import { StorybookConfig } from "@stencil/storybook-plugin";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(js|jsx|ts|tsx)"],
  addons: [
    "@storybook/addon-links",
    "@storybook/addon-essentials",
    "@storybook/addon-interactions",
  ],
  framework: {
    name: "@stencil/storybook-plugin",
  },
  staticDirs: [{ from: "../dist", to: "/dist" }],
  // async viteFinal(config, { configType }) {
  //   const { mergeConfig } = await import("vite");
  //   if (configType !== "DEVELOPMENT") {
  //     return config;
  //   }
  //   return mergeConfig(config, {
  //     build: {
  //       outDir: "dist-vite",
  //     },
  //   });
  // },
};

export default config;
