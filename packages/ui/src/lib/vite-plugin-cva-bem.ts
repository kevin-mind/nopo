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

interface CVABEMPluginOptions {
  include?: string[];
  exclude?: string[];
  outputPath?: string;
  componentPrefix?: string;
}

export function cvaBEMPlugin(options: CVABEMPluginOptions = {}): Plugin {
  const {
    include = ["**/*.{ts,tsx}"],
    exclude = ["**/*.d.ts", "**/node_modules/**"],
    outputPath = "bem-components.css",
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

      const fileName = path.basename(outputPath);

      // Emit the CSS file as a build asset
      this.emitFile({
        type: "asset",
        fileName,
        source: css,
      });

      console.log(
        `Generated BEM CSS for ${variantKeys.length} components: ${fileName}`,
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

      // Parse the config object
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
    // A bit of a hacky way to evaluate the object string.
    // WARNING: Not safe for untrusted input, but acceptable in a build tool context.
    const evaluatedConfig = new Function(`return ${configStr}`)();

    return {
      variants: evaluatedConfig.variants || {},
      defaultVariants: evaluatedConfig.defaultVariants || {},
    };
  } catch (error) {
    console.warn(
      "Failed to parse config object, falling back to regex:",
      error,
    );
    // Fallback to regex method if function constructor fails
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
 * This version creates a self-contained class for every possible variant combination.
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

    css += `/* === ${variant.name} === */\n\n`;
    css += generateAllVariantClasses(
      prefixedName,
      variant.baseClasses,
      variant.config,
      variant.defaultVariants || {},
    );
  }

  return css;
}

/**
 * Generates self-contained CSS classes for every possible combination of variants.
 * The class name is determined by its difference from the default variants.
 * @param componentName The base BEM block name (e.g., "button").
 * @param baseClasses The base tailwind classes to apply to all variants.
 * @param config The "variants" object from the CVA config.
 * @param defaultVariants The "defaultVariants" object from the CVA config.
 * @returns A string of CSS rules.
 */
function generateAllVariantClasses(
  componentName: string,
  baseClasses: string,
  config: VariantsMap,
  defaultVariants: DefaultVariantsMap,
): string {
  let css = "";
  const variantTypes = Object.keys(config);

  if (variantTypes.length === 0) {
    // If no variants, just generate the base class
    css += `.${componentName} {\n`;
    css += `  @apply ${baseClasses};\n`;
    css += `}\n\n`;
    return css;
  }

  // Helper to compute the Cartesian product of multiple arrays.
  const cartesian = <T>(arrays: T[][]): T[][] => {
    if (!arrays || arrays.length === 0) return [[]];
    return arrays.reduce<T[][]>(
      (acc, curr) => acc.flatMap((a) => curr.map((c) => [...a, c])),
      [[]],
    );
  };

  const valueSets = variantTypes.map((type) => Object.keys(config[type] || {}));
  const combinations = cartesian(valueSets);

  for (const combination of combinations) {
    if (combination.length === 0) continue;

    const modifierParts: string[] = [];
    const classesToApply: string[] = [baseClasses];

    combination.forEach((valueKey, index) => {
      const typeKey = variantTypes[index];
      if (!typeKey) return;

      // Add the variant's classes to our apply list
      const variantClasses = config[typeKey]?.[valueKey];
      if (variantClasses) {
        classesToApply.push(variantClasses);
      }

      // Check if this part of the combination is a default value
      const defaultValue = defaultVariants[typeKey];
      if (valueKey !== defaultValue) {
        modifierParts.push(valueKey);
      }
    });

    // Determine the final selector name
    const selector =
      modifierParts.length > 0
        ? `.${componentName}--${modifierParts.join("--")}`
        : `.${componentName}`;

    // Generate the CSS rule
    css += `${selector} {\n`;
    css += `  @apply ${classesToApply.join(" ")};\n`;
    css += `}\n\n`;
  }

  return css;
}
