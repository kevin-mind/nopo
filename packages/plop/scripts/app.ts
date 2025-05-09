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
        message: "what is the name of the app",
      },
    ],
    actions: [
      {
        type: "addMany",
        base: "../templates/app",
        destination: "../../../apps/{{name}}",
        transform: (data) => {
          return data;
        },
        templateFiles: "../templates/app/**",
        stripExtensions: ["hbs"],
        globOptions: {
          dot: true,
        },
      },
    ],
  });
}
