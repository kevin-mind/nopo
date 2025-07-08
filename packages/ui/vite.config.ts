import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { glob } from 'glob';
import dts from 'vite-plugin-dts';

// Get all TypeScript files for individual exports
const entry = glob.sync('src/**/*.{ts,tsx}', {
  ignore: ['src/**/*.test.{ts,tsx}', 'src/**/*.stories.{ts,tsx}']
}).reduce((entries, file) => {
  const key = file.replace(/^src\//, '').replace(/\.tsx?$/, '');
  entries[key] = resolve(__dirname, file);
  return entries;
}, {} as Record<string, string>);

export default defineConfig({
  plugins: [
    react(),
    dts({
      insertTypesEntry: true,
      exclude: ['**/*.test.{ts,tsx}', '**/*.stories.{ts,tsx}']
    })
  ],
  build: {
    lib: {
      entry,
      formats: ['es']
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime'],
      output: {
        preserveModules: true,
        preserveModulesRoot: 'src',
        entryFileNames: ({ name }) => `${name}.js`
      }
    },
    sourcemap: true,
    emptyOutDir: true
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src')
    }
  }
});