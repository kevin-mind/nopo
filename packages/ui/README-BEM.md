# BEM CSS Generation for Backend Usage

This package automatically generates BEM-compliant CSS classes from your CVA (Class Variance Authority) component variants, allowing you to use the same component styling in backend HTML templates.

## Generated CSS

The build process automatically analyzes all component files containing `cva()` functions and generates corresponding BEM CSS classes in `build/bem-components.css`.

### Example: Button Component

From the `buttonVariants` cva function in `src/components/button.tsx`, the following BEM classes are generated:

#### Base Class
```css
.button {
  @apply inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50...;
}
```

#### Variant Modifiers
```css
.button--ghost {
  @apply hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50;
}

.button--small {
  @apply h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5;
}
```

#### Combined Variants
```css
.button--ghost--small {
  @apply hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50 h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5;
}
```

## Backend Usage

### 1. Import the CSS

In your backend project, import the generated CSS:

```html
<!-- In your HTML template -->
<link rel="stylesheet" href="node_modules/@more/ui/build/bem-components.css">
```

Or if using a build system:

```css
/* In your main CSS file */
@import '@more/ui/bem-components.css';
```

### 2. Use BEM Classes in Templates

#### Basic Button
```html
<button class="button">Default Button</button>
```

#### Button with Single Variant
```html
<button class="button button--ghost">Ghost Button</button>
<button class="button button--small">Small Button</button>
```

#### Button with Combined Variants
```html
<button class="button button--ghost--small">Small Ghost Button</button>
<button class="button button--destructive--large">Large Destructive Button</button>
```

### 3. Framework Examples

#### Django Templates
```django
<button class="button button--{{ variant }}--{{ size }}">
  {{ button_text }}
</button>
```

#### Rails ERB
```erb
<button class="button button--<%= variant %>--<%= size %>">
  <%= button_text %>
</button>
```

#### Laravel Blade
```blade
<button class="button button--{{ $variant }}--{{ $size }}">
  {{ $buttonText }}
</button>
```

#### Node.js/Express with Handlebars
```handlebars
<button class="button button--{{variant}}--{{size}}">
  {{buttonText}}
</button>
```

## Available Classes

### Button Variants
- `variant`: `default`, `destructive`, `outline`, `secondary`, `ghost`, `link`
- `size`: `default`, `sm`, `lg`, `icon`

### Usage Patterns
1. **Base only**: `button`
2. **Single variant**: `button button--ghost`
3. **Combined variants**: `button button--ghost--sm`

## Customization

The BEM CSS generation can be customized in `vite.config.ts`:

```typescript
cvaBEMPlugin({
  componentPrefix: 'ui',        // Adds prefix: .ui-button
  outputPath: 'build/bem.css', // Custom output path
})
```

## Build Integration

The CSS is automatically generated during the build process. To regenerate:

```bash
pnpm build
```

This ensures your backend styling stays in sync with your frontend components.

## Benefits

1. **Consistency**: Same styling system across frontend and backend
2. **Type Safety**: Generated from the same CVA definitions
3. **Maintainability**: Automatically updates when components change
4. **Performance**: Pre-compiled CSS, no runtime overhead
5. **BEM Compliance**: Clean, semantic class names