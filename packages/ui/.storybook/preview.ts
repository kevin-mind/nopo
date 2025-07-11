import type { Preview } from '@storybook/react';
import '../src/lib/theme.css';

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    viewport: {
      viewports: {
        small: {
          name: 'Small',
          styles: {
            width: '375px',
            height: '667px',
          },
        },
        medium: {
          name: 'Medium',
          styles: {
            width: '768px',
            height: '1024px',
          },
        },
        large: {
          name: 'Large',
          styles: {
            width: '1200px',
            height: '800px',
          },
        },
      },
    },
  },
  globalTypes: {
    theme: {
      description: 'Global theme for components',
      defaultValue: 'light',
      toolbar: {
        title: 'Theme',
        icon: 'paintbrush',
        items: ['light', 'dark'],
        dynamicTitle: true,
      },
    },
  },
};

export default preview;