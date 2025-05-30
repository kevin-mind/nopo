import type { NodePlopAPI } from "plop";

export default function (plop: NodePlopAPI) {
  plop.setGenerator("Package", {
    description: "create new package",
    prompts: [
      {
        type: "input",
        name: "scope",
        message: "what is the scope of the package",
        default: "@more",
      },
      {
        type: "input",
        name: "name",
        message: "what is the name of the package",
      },
      {
        type: "list",
        name: "tsconfigPreset",
        message: "which tsconfig preset to use",
        choices: ["base", "node", "dom"],
      },
    ],
    actions: [
      {
        type: "addMany",
        base: "../templates/package",
        destination: "../../{{name}}",
        transform: (data) => {
          return data;
        },
        templateFiles: "../templates/package/**",
        stripExtensions: ["hbs"],
        globOptions: {
          dot: true,
        },
      },
    ],
  });
}
