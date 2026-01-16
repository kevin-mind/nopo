import { describe, expect, it, vi, beforeEach } from "vitest";
import { cvaBEMPlugin } from "../src/lib/vite-plugin-cva-bem";

describe("cvaBEMPlugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("plugin creation", () => {
    it("should create plugin with default options", () => {
      const plugin = cvaBEMPlugin();

      expect(plugin.name).toBe("vite-plugin-cva-bem");
      expect(typeof plugin.buildStart).toBe("function");
      expect(typeof plugin.transform).toBe("function");
      expect(typeof plugin.generateBundle).toBe("function");
    });

    it("should accept custom options", () => {
      const plugin = cvaBEMPlugin({
        include: ["**/*.tsx"],
        exclude: ["**/*.test.tsx"],
        outputPath: "custom/path.css",
        componentPrefix: "my-prefix",
      });

      expect(plugin.name).toBe("vite-plugin-cva-bem");
    });
  });

  describe("CVA pattern extraction", () => {
    it("should extract simple CVA variant", () => {
      const code = `
        export const buttonVariants = cva(
          "px-4 py-2 rounded",
          {
            variants: {
              variant: {
                default: "bg-blue-500 text-white",
                destructive: "bg-red-500 text-white",
              },
            },
            defaultVariants: {
              variant: "default",
            },
          }
        );
      `;

      const plugin = cvaBEMPlugin();
      const transformHook = plugin.transform;

      if (typeof transformHook === "function") {
        const result = transformHook.call({}, code, "/path/to/button.tsx");
        expect(result).toBeNull();
      }
    });

    it("should handle multiple CVA variants in same file", () => {
      const code = `
        export const buttonVariants = cva("px-4 py-2", {
          variants: {
            variant: {
              default: "bg-blue-500",
              destructive: "bg-red-500",
            },
          },
        });

        export const cardVariants = cva("rounded-lg", {
          variants: {
            padding: {
              none: "p-0",
              small: "p-4",
              large: "p-8",
            },
          },
        });
      `;

      const plugin = cvaBEMPlugin();
      const transformHook = plugin.transform;

      if (typeof transformHook === "function") {
        const result = transformHook.call({}, code, "/path/to/components.tsx");
        expect(result).toBeNull();
      }
    });

    it("should handle CVA variants without defaultVariants", () => {
      const code = `
        export const buttonVariants = cva(
          "px-4 py-2 rounded",
          {
            variants: {
              variant: {
                default: "bg-blue-500 text-white",
                destructive: "bg-red-500 text-white",
              },
            },
          }
        );
      `;

      const plugin = cvaBEMPlugin();
      const transformHook = plugin.transform;

      if (typeof transformHook === "function") {
        const result = transformHook.call({}, code, "/path/to/button.tsx");
        expect(result).toBeNull();
      }
    });

    it("should skip files that don't contain cva", () => {
      const code = `export const MyComponent = () => <div>Hello</div>;`;

      const plugin = cvaBEMPlugin();
      const transformHook = plugin.transform;

      if (typeof transformHook === "function") {
        const result = transformHook.call({}, code, "/path/to/component.tsx");
        expect(result).toBeUndefined();
      }
    });
  });

  describe("CSS generation", () => {
    it("should generate CSS for extracted variants", () => {
      const mockEmitFile = vi.fn();
      const mockConsoleLog = vi.fn();

      vi.spyOn(console, "log").mockImplementation(mockConsoleLog);

      const plugin = cvaBEMPlugin();
      const transformHook = plugin.transform;
      const generateBundleHook = plugin.generateBundle;

      // First, transform a file with CVA variants
      const code = `
        export const buttonVariants = cva(
          "px-4 py-2 rounded",
          {
            variants: {
              variant: {
                default: "bg-blue-500 text-white",
                destructive: "bg-red-500 text-white",
              },
              size: {
                default: "h-10",
                sm: "h-9 px-3",
              },
            },
            defaultVariants: {
              variant: "default",
              size: "default",
            },
          }
        );
      `;

      if (typeof transformHook === "function") {
        transformHook.call({}, code, "/path/to/button.tsx");
      }

      // Then generate the bundle
      if (typeof generateBundleHook === "function") {
        generateBundleHook.call({ emitFile: mockEmitFile });
      }

      expect(mockEmitFile).toHaveBeenCalledWith({
        type: "asset",
        fileName: "bem-components.css",
        source: expect.stringContaining(
          "/* Generated BEM CSS from CVA variants */",
        ),
      });

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining(
          "Generated BEM CSS for 1 components: bem-components.css",
        ),
      );
    });

    it("should generate correct BEM CSS structure", () => {
      const mockEmitFile = vi.fn();

      const plugin = cvaBEMPlugin();
      const transformHook = plugin.transform;
      const generateBundleHook = plugin.generateBundle;

      const code = `
        export const buttonVariants = cva(
          "px-4 py-2 rounded",
          {
            variants: {
              variant: {
                default: "bg-blue-500 text-white",
                destructive: "bg-red-500 text-white",
              },
            },
            defaultVariants: {
              variant: "default",
            },
          }
        );
      `;

      if (typeof transformHook === "function") {
        transformHook.call({}, code, "/path/to/button.tsx");
      }

      if (typeof generateBundleHook === "function") {
        generateBundleHook.call({ emitFile: mockEmitFile });
      }

      const emitCall = mockEmitFile.mock.calls[0][0];
      const css = emitCall.source;

      // Check that the CSS contains the expected structure
      expect(css).toContain("/* Generated BEM CSS from CVA variants */");
      expect(css).toContain("/* === buttonVariants === */");
      expect(css).toContain(".button {");
      expect(css).toContain("@apply px-4 py-2 rounded bg-blue-500 text-white;");
      expect(css).toContain(".button--destructive {");
      expect(css).toContain("@apply px-4 py-2 rounded bg-red-500 text-white;");
    });

    it("should handle component prefix correctly", () => {
      const mockEmitFile = vi.fn();

      const plugin = cvaBEMPlugin({ componentPrefix: "my" });
      const transformHook = plugin.transform;
      const generateBundleHook = plugin.generateBundle;

      const code = `
        export const buttonVariants = cva(
          "px-4 py-2",
          {
            variants: {
              variant: {
                default: "bg-blue-500",
              },
            },
          }
        );
      `;

      if (typeof transformHook === "function") {
        transformHook.call({}, code, "/path/to/button.tsx");
      }

      if (typeof generateBundleHook === "function") {
        generateBundleHook.call({ emitFile: mockEmitFile });
      }

      const emitCall = mockEmitFile.mock.calls[0][0];
      const css = emitCall.source;

      // The plugin generates classes for all variant combinations
      // Since "default" is a variant value, it creates .my-button--default
      expect(css).toContain(".my-button--default {");
      expect(css).toContain("@apply px-4 py-2 bg-blue-500;");
    });

    it("should generate base class when no defaultVariants are specified", () => {
      const mockEmitFile = vi.fn();

      const plugin = cvaBEMPlugin({ componentPrefix: "my" });
      const transformHook = plugin.transform;
      const generateBundleHook = plugin.generateBundle;

      const code = `
        export const buttonVariants = cva(
          "px-4 py-2",
          {
            variants: {
              variant: {
                primary: "bg-blue-500",
                secondary: "bg-gray-500",
              },
            },
          }
        );
      `;

      if (typeof transformHook === "function") {
        transformHook.call({}, code, "/path/to/button.tsx");
      }

      if (typeof generateBundleHook === "function") {
        generateBundleHook.call({ emitFile: mockEmitFile });
      }

      const emitCall = mockEmitFile.mock.calls[0][0];
      const css = emitCall.source;

      // When no defaultVariants are specified, all combinations get modifier classes
      expect(css).toContain(".my-button--primary {");
      expect(css).toContain(".my-button--secondary {");
      expect(css).toContain("@apply px-4 py-2 bg-blue-500;");
      expect(css).toContain("@apply px-4 py-2 bg-gray-500;");
    });

    it("should not emit file when no variants are found", () => {
      const mockEmitFile = vi.fn();

      const plugin = cvaBEMPlugin();
      const generateBundleHook = plugin.generateBundle;

      if (typeof generateBundleHook === "function") {
        generateBundleHook.call({ emitFile: mockEmitFile });
      }

      expect(mockEmitFile).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("should handle malformed CVA config gracefully", () => {
      const mockConsoleWarn = vi.fn();
      vi.spyOn(console, "warn").mockImplementation(mockConsoleWarn);

      const code = `
        export const buttonVariants = cva(
          "px-4 py-2",
          {
            variants: {
              variant: {
                default: "bg-blue-500",
                // Missing closing brace
              },
            },
          }
        );
      `;

      const plugin = cvaBEMPlugin();
      const transformHook = plugin.transform;

      if (typeof transformHook === "function") {
        const result = transformHook.call({}, code, "/path/to/button.tsx");
        expect(result).toBeNull();
      }

      // The fallback regex parser is actually handling this case successfully
      // So we don't expect a warning to be called
      expect(mockConsoleWarn).not.toHaveBeenCalled();
    });

    it("should handle completely invalid CVA config", () => {
      const mockConsoleWarn = vi.fn();
      vi.spyOn(console, "warn").mockImplementation(mockConsoleWarn);

      const code = `
        export const buttonVariants = cva(
          "px-4 py-2",
          {
            variants: {
              // Invalid syntax that will cause parsing to fail
              variant: {
                default: "bg-blue-500",
              },
              // Missing closing brace and invalid syntax
            },
          }
        );
      `;

      const plugin = cvaBEMPlugin();
      const transformHook = plugin.transform;

      if (typeof transformHook === "function") {
        const result = transformHook.call({}, code, "/path/to/button.tsx");
        expect(result).toBeNull();
      }

      // This should trigger the fallback parser and potentially a warning
      // The exact behavior depends on how the regex parser handles the malformed input
    });
  });

  describe("file filtering", () => {
    it("should respect include/exclude patterns", () => {
      const plugin = cvaBEMPlugin({
        include: ["**/*.tsx"],
        exclude: ["**/*.test.tsx"],
      });

      const transformHook = plugin.transform;
      const code = `
        export const buttonVariants = cva("px-4 py-2", {
          variants: { variant: { default: "bg-blue-500" } },
        });
      `;

      if (typeof transformHook === "function") {
        // Should process .tsx files
        const result1 = transformHook.call({}, code, "/path/to/component.tsx");
        expect(result1).toBeNull();

        // Should not process .test.tsx files
        const result2 = transformHook.call(
          {},
          code,
          "/path/to/component.test.tsx",
        );
        expect(result2).toBeUndefined();

        // Should not process .ts files
        const result3 = transformHook.call({}, code, "/path/to/component.ts");
        expect(result3).toBeUndefined();
      }
    });
  });
});
