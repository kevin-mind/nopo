import { Config } from "@stencil/core";
import { reactOutputTarget } from "@stencil/react-output-target";

export const config: Config = {
  namespace: "more-ui",
  outputTargets: [
    {
      type: "dist",
      esmLoaderPath: "../loader",
    },
    {
      type: "dist-hydrate-script",
      dir: "./hydrate",
    },
    {
      type: "dist-custom-elements",
      externalRuntime: false,
    },
    reactOutputTarget({
      outDir: "../ui-react/src/",
      esModules: true,
    }),
  ],
  testing: {
    browserHeadless: "shell",
  },
};
