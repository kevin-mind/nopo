import type { Plugin } from "vite";
import path from "node:path";
import { createFilter } from "@rollup/pluginutils";

// A map of variant values to class strings
type VariantValueMap = Record<string, string>;

// A map of variant names to their value maps
type VariantsMap = Record<string, VariantValueMap>;

// A map of variant names to their default value
type DefaultVariantsMap = Record<string, string>;

interface CVAConfig {
  variants: VariantsMap;
  defaultVariants?: DefaultVariantsMap;
}
interface CVAVariant {
  name: string;
  config: VariantsMap;
  baseClasses: string;
  defaultVariants?: DefaultVariantsMap;
}

export interface CVABEMPluginOptions {
  include?: string[];
  exclude?: string[];
  outputPath?: string;
  componentPrefix?: string;
}

export function cvaBEMPlugin(options: CVABEMPluginOptions = {}): Plugin {
  const {
    include = ["**/*.{ts,tsx}"],
    exclude = ["**/*.d.ts", "**/node_modules/**"],
    outputPath = "build/bem-components.css",
    componentPrefix = "",
  } = options;

  const filter = createFilter(include, exclude);
  let cvaVariants: Record<string, CVAVariant> = {};

  return {
    name: "vite-plugin-cva-bem",
    buildStart() {
      // Clear variants on build start
      cvaVariants = {};
    },
    transform(code: string, id: string) {
      if (!filter(id)) {
        return;
      }

      // Skip if file doesn't contain cva
      if (!code.includes("cva(")) {
        return;
      }

      const variants = extractCVAVariants(code, id);
      for (let i = 0; i < variants.length; i++) {
        const variant = variants[i];
        if (variant) {
          cvaVariants[variant.name] = variant;
        }
      }

      return null;
    },
    generateBundle() {
      const variantKeys = Object.keys(cvaVariants);
      if (variantKeys.length === 0) {
        return;
      }

      const css = generateBEMCSS(cvaVariants, componentPrefix);

      // Emit the CSS file as a build asset
      this.emitFile({
        type: "asset",
        fileName: path.basename(outputPath),
        source: css,
      });

      console.log(
        `Generated BEM CSS for ${variantKeys.length} components: ${outputPath}`,
      );
    },
  };
}

function extractCVAVariants(code: string, filePath: string): CVAVariant[] {
  const variants: CVAVariant[] = [];

  // Regex to match cva function calls with their exports
  const cvaRegex =
    /(?:export\s+)?(?:const|let|var)\s+(\w+Variants?)\s*=\s*cva\s*\(\s*([^,]+),\s*({[\s\S]*?})\s*\)/g;

  let match;
  while ((match = cvaRegex.exec(code)) !== null) {
    const [, variableName, baseClassesRaw, configRaw] = match;

    if (!variableName || !baseClassesRaw || !configRaw) {
      continue;
    }

    try {
      // Clean up the base classes string (remove quotes and normalize)
      const baseClasses = baseClassesRaw.trim().replace(/^["'`]|["'`]$/g, "");

      // Parse the config object (this is a simplified parser)
      const config = parseConfigObject(configRaw);

      if (config.variants) {
        variants.push({
          name: variableName,
          config: config.variants,
          baseClasses,
          defaultVariants: config.defaultVariants,
        });
      }
    } catch (error) {
      console.warn(`Failed to parse CVA variant in ${filePath}:`, error);
    }
  }

  return variants;
}

function parseConfigObject(configStr: string): Partial<CVAConfig> {
  try {
    // This is a simplified parser and may not handle all edge cases.
    // A more robust solution would use an AST parser.
    // For now, we use regex to extract the variants and defaultVariants objects.
    const sanitizedConfigStr = configStr.replace(/\s/g, "");

    // A bit of a hacky way to evaluate the object string.
    // WARNING: Not safe for untrusted input, but acceptable in a build tool context.
    const evaluatedConfig = (new Function(`return ${configStr}`))();

    return {
        variants: evaluatedConfig.variants || {},
        defaultVariants: evaluatedConfig.defaultVariants || {},
    };

  } catch (error) {
    console.warn("Failed to parse config object, falling back to regex:", error);
    // Fallback to original regex method if function constructor fails
    const cleaned = configStr.trim().slice(1, -1);
    const variantsMatch = cleaned.match(
      /variants:\s*{([\s\S]*?)},?\s*(?:defaultVariants|$)/,
    );
    const defaultVariantsMatch = cleaned.match(
      /defaultVariants:\s*{([\s\S]*?)}\s*$/,
    );

    let variants: VariantsMap = {};
    let defaultVariants: DefaultVariantsMap = {};

    if (variantsMatch && variantsMatch[1]) {
      variants = parseVariantsObject(variantsMatch[1]);
    }

    if (defaultVariantsMatch && defaultVariantsMatch[1]) {
      defaultVariants = parseDefaultVariants(defaultVariantsMatch[1]);
    }

    return { variants, defaultVariants };
  }
}

function parseVariantsObject(variantsStr: string): VariantsMap {
  const variants: VariantsMap = {};
  const variantMatches = variantsStr.match(
    /(\w+):\s*{([^{}]*(?:{[^{}]*}[^{}]*)*)}/g,
  );

  if (variantMatches) {
    for (const variantMatch of variantMatches) {
      const matchResult = variantMatch.match(/(\w+):\s*{([\s\S]*)}/);
      if (matchResult) {
        const [, variantName, variantContent] = matchResult;
        if (variantName && variantContent) {
          variants[variantName] = parseVariantValues(variantContent);
        }
      }
    }
  }
  return variants;
}

function parseVariantValues(contentStr: string): VariantValueMap {
  const values: VariantValueMap = {};
  const valueMatches = contentStr.match(/(\w+):\s*["'`]([^"'`]*)["'`]/g);

  if (valueMatches) {
    for (const valueMatch of valueMatches) {
      const matchResult = valueMatch.match(/(\w+):\s*["'`]([^"'`]*)["'`]/);
      if (matchResult) {
        const [, key, classes] = matchResult;
        if (key && classes !== undefined) {
          values[key] = classes.trim();
        }
      }
    }
  }
  return values;
}

function parseDefaultVariants(defaultStr: string): DefaultVariantsMap {
  const defaults: DefaultVariantsMap = {};
  const matches = defaultStr.match(/(\w+):\s*["'`]([^"'`]*)["'`]/g);

  if (matches) {
    for (const match of matches) {
      const matchResult = match.match(/(\w+):\s*["'`]([^"'`]*)["'`]/);
      if (matchResult) {
        const [, key, value] = matchResult;
        if (key && value) {
          defaults[key] = value;
        }
      }
    }
  }
  return defaults;
}

/**
 * Generates the full BEM-style CSS string from all extracted CVA variants.
 * This version only creates the base class and fully compounded variant classes.
 */
function generateBEMCSS(
  variants: Record<string, CVAVariant>,
  componentPrefix: string,
): string {
  let css = `/* Generated BEM CSS from CVA variants */\n/* This file is auto-generated. Do not edit manually. */\n\n`;

  for (const variantKey in variants) {
    const variant = variants[variantKey];
    if (!variant) continue;

    const componentName = variant.name.replace(/Variants?$/, "").toLowerCase();
    const prefixedName = componentPrefix
      ? `${componentPrefix}-${componentName}`
      : componentName;

    // 1. Generate the base component class
    css += `/* Base for ${componentName} */\n`;
    css += `.${prefixedName} {\n`;
    css += `  @apply ${variant.baseClasses};\n`;
    css += `}\n\n`;

    // 2. Generate fully compounded variant classes
    const configKeys = Object.keys(variant.config);
    if (configKeys.length > 0) {
      css += `/* Compound variants for ${prefixedName} */\n`;
      css += generateCompoundVariants(prefixedName, variant.config);
    }
  }

  return css;
}

/**
 * Generates CSS for every possible combination of variants (Cartesian product).
 * @param componentName The base BEM block name (e.g., "button").
 * @param config The "variants" object from the CVA config.
 * @returns A string of CSS rules.
 */
function generateCompoundVariants(
  componentName: string,
  config: VariantsMap,
): string {
  let css = "";
  const variantTypes = Object.keys(config);

  if (variantTypes.length === 0) {
    return "";
  }

  // Helper to compute the Cartesian product of multiple arrays.
  const cartesian = <T>(arrays: T[][]): T[][] => {
    if (!arrays || arrays.length === 0) {
      return [[]];
    }
    return arrays.reduce<T[][]>(
      (acc, curr) => acc.flatMap(a => curr.map(c => [...a, c])),
      [[]], // Initial value is an array with a single empty array.
    );
  };

  // Create an array of arrays, where each inner array holds the keys for one variant type.
  // e.g., [['default', 'destructive', ...], ['default', 'sm', ...]]
  const valueSets = variantTypes.map(type => {
    const variantConfig = config[type];
    return variantConfig ? Object.keys(variantConfig) : [];
  });

  // Get all combinations, e.g., [['default', 'sm'], ['destructive', 'sm'], ...]
  const combinations = cartesian(valueSets);

  for (const combination of combinations) {
    if (combination.length === 0) continue;

    // Create the BEM selector, e.g., .button--default--sm
    const selector = `.${componentName}--${combination.join("--")}`;

    // Collect all Tailwind classes for the current combination.
    const classesToApply = combination
      .map((valueKey, index) => {
        const typeKey = variantTypes[index];
        if (!typeKey) return "";
        const variantConfig = config[typeKey];
        return variantConfig ? variantConfig[valueKey] : "";
      })
      .filter(Boolean)
      .join(" ");

    if (classesToApply) {
      css += `${selector} {\n`;
      css += `  @apply ${classesToApply};\n`;
      css += `}\n\n`;
    }
  }

  return css;
}
