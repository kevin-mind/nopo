export default function (plop) {
  // Component generator
  plop.setGenerator('component', {
    description: 'Create a new React component',
    prompts: [
      {
        type: 'input',
        name: 'name',
        message: 'Component name (PascalCase):',
        validate: (input) => {
          if (!input) return 'Component name is required';
          if (!/^[A-Z][a-zA-Z0-9]*$/.test(input)) {
            return 'Component name must be in PascalCase (e.g., MyComponent)';
          }
          return true;
        },
      },
      {
        type: 'input',
        name: 'description',
        message: 'Component description:',
        default: 'A reusable UI component',
      },
      {
        type: 'confirm',
        name: 'hasVariants',
        message: 'Does this component need variants (using CVA)?',
        default: true,
      },
      {
        type: 'confirm',
        name: 'hasStories',
        message: 'Create Storybook stories?',
        default: true,
      },
      {
        type: 'confirm',
        name: 'hasTests',
        message: 'Create test file?',
        default: true,
      },
    ],
    actions: (data) => {
      const actions = [
        {
          type: 'add',
          path: 'src/components/{{kebabCase name}}.tsx',
          templateFile: 'plop-templates/component.hbs',
        },
      ];

      if (data.hasStories) {
        actions.push({
          type: 'add',
          path: 'src/components/{{kebabCase name}}.stories.tsx',
          templateFile: 'plop-templates/stories.hbs',
        });
      }

      if (data.hasTests) {
        actions.push({
          type: 'add',
          path: 'src/components/{{kebabCase name}}.test.tsx',
          templateFile: 'plop-templates/test.hbs',
        });
      }

      // Update component index
      actions.push({
        type: 'modify',
        path: 'src/components/index.ts',
        pattern: /(\/\/ Export all components)/g,
        template: '$1\nexport { {{pascalCase name}}, type {{pascalCase name}}Props } from \'./{{kebabCase name}}\';',
      });

      return actions;
    },
  });
}