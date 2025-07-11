# Storybook Setup for @more/ui

This package now includes Storybook with comprehensive testing capabilities.

## Features

- **Interactive Component Stories**: Browse and interact with components in isolation
- **Interaction Testing**: Automated tests that simulate user interactions
- **Snapshot Testing**: Visual regression testing with image snapshots
- **Theme Support**: Light/dark theme switching in the Storybook interface
- **TypeScript**: Full TypeScript support with strong typing

## Scripts

```bash
# Run Storybook development server
pnpm storybook

# Build Storybook for production
pnpm build-storybook

# Run all tests (vitest + storybook)
pnpm test

# Run vitest tests only
pnpm test:vitest

# Run Storybook interaction tests only
pnpm test:storybook
```

## File Structure

```
.storybook/
├── main.ts              # Storybook configuration
├── preview.tsx          # Global decorators and parameters
├── test-runner.ts       # Test runner configuration
├── tsconfig.json        # TypeScript configuration
└── .gitignore          # Ignore generated files

src/components/
└── button.stories.tsx   # Button component stories with tests
```

## Testing Features

### Interaction Tests

The Button stories include comprehensive interaction tests:

- **Click Detection**: Verifies click events are properly fired
- **Keyboard Navigation**: Tests Space and Enter key interactions
- **Focus Management**: Ensures proper focus behavior
- **Multiple Clicks**: Tests rapid click scenarios
- **Disabled State**: Verifies disabled buttons don't respond to interactions

### Snapshot Testing

The `AllVariants` story generates visual snapshots for regression testing:

- Captures all button variants and sizes
- Compares against baseline images
- Configurable threshold for changes (20% by default)

## Story Structure

Each story follows this pattern:

```typescript
export const StoryName: Story = {
  args: {
    // Component props
  },
  play: async ({ canvasElement, args }) => {
    // Interaction tests
  },
};
```

## Theme Testing

Stories support both light and dark themes through the Storybook toolbar. The theme decorator automatically applies the appropriate classes.

## Dependencies

Key dependencies added:

- `@storybook/react` - Core Storybook for React
- `@storybook/test` - Testing utilities and interactions
- `@storybook/test-runner` - Test runner for CI/CD
- `jest-image-snapshot` - Visual regression testing
- `@testing-library/react` - Component testing utilities

## CI Integration

The test runner is configured to work with Playwright and can be integrated into CI/CD pipelines:

```bash
# Start Storybook and run tests
pnpm storybook &
pnpm test:storybook
```