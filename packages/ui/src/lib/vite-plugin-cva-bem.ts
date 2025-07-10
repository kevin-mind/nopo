import type { Plugin } from 'vite';
import path from 'node:path';

interface CVAVariant {
  name: string;
  config: any;
  baseClasses: string;
  defaultVariants?: any;
}

export interface CVABEMPluginOptions {
  include?: string[];
  exclude?: string[];
  outputPath?: string;
  componentPrefix?: string;
}

export function cvaBEMPlugin(options: CVABEMPluginOptions = {}): Plugin {
  const {
    include = ['**/*.{ts,tsx}'],
    exclude = ['**/*.d.ts', '**/node_modules/**'],
    outputPath = 'build/bem-components.css',
    componentPrefix = ''
  } = options;

  let cvaVariants: any = {};

  return {
    name: 'vite-plugin-cva-bem',
    buildStart() {
      // Clear variants on build start
      cvaVariants = {};
    },
    transform(code: string, id: string) {
      // Only process TypeScript/TSX files
      if (!id.endsWith('.ts') && !id.endsWith('.tsx')) {
        return;
      }

      // Skip if file doesn't contain cva
      if (!code.includes('cva(')) {
        return;
      }

      const variants = extractCVAVariants(code, id);
      for (let i = 0; i < variants.length; i++) {
        const variant = variants[i];
        cvaVariants[variant.name] = variant;
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
        type: 'asset',
        fileName: path.basename(outputPath),
        source: css
      });

      console.log(`Generated BEM CSS for ${variantKeys.length} components: ${outputPath}`);
    }
  };
}

function extractCVAVariants(code: string, filePath: string): CVAVariant[] {
  const variants: CVAVariant[] = [];

  // Regex to match cva function calls with their exports
  const cvaRegex = /(?:export\s+)?(?:const|let|var)\s+(\w+Variants?)\s*=\s*cva\s*\(\s*([^,]+),\s*({[\s\S]*?})\s*\)/g;
  
  let match;
  while ((match = cvaRegex.exec(code)) !== null) {
    const [, variableName, baseClassesRaw, configRaw] = match;
    
    try {
      // Clean up the base classes string (remove quotes and normalize)
      const baseClasses = baseClassesRaw.trim().replace(/^["'`]|["'`]$/g, '');
      
      // Parse the config object (this is a simplified parser)
      const config = parseConfigObject(configRaw);
      
      if (config.variants) {
        variants.push({
          name: variableName,
          config: config.variants,
          baseClasses,
          defaultVariants: config.defaultVariants
        });
      }
    } catch (error) {
      console.warn(`Failed to parse CVA variant in ${filePath}:`, error);
    }
  }

  return variants;
}

function parseConfigObject(configStr: string): any {
  try {
    // Remove outer braces and normalize
    const cleaned = configStr.trim().slice(1, -1);
    
    // Extract variants section
    const variantsMatch = cleaned.match(/variants:\s*{([\s\S]*?)},?\s*(?:defaultVariants|$)/);
    const defaultVariantsMatch = cleaned.match(/defaultVariants:\s*{([\s\S]*?)}\s*$/);
    
    let variants = {};
    let defaultVariants = {};
    
    if (variantsMatch) {
      variants = parseVariantsObject(variantsMatch[1]);
    }
    
    if (defaultVariantsMatch) {
      defaultVariants = parseDefaultVariants(defaultVariantsMatch[1]);
    }
    
    return { variants, defaultVariants };
  } catch (error) {
    console.warn('Failed to parse config object:', error);
    return { variants: {}, defaultVariants: {} };
  }
}

function parseVariantsObject(variantsStr: string): any {
  const variants: any = {};
  
  // Split by variant groups (looking for pattern: variantName: { ... })
  const variantMatches = variantsStr.match(/(\w+):\s*{([^{}]*(?:{[^{}]*}[^{}]*)*)}/g);
  
  if (variantMatches) {
    for (let i = 0; i < variantMatches.length; i++) {
      const variantMatch = variantMatches[i];
      const matchResult = variantMatch.match(/(\w+):\s*{([\s\S]*)}/) || [];
      const variantName = matchResult[1];
      const variantContent = matchResult[2];
      if (variantName && variantContent) {
        variants[variantName] = parseVariantValues(variantContent);
      }
    }
  }
  
  return variants;
}

function parseVariantValues(contentStr: string): any {
  const values: any = {};
  
  // Match patterns like: default: "classes here",
  const valueMatches = contentStr.match(/(\w+):\s*["'`]([^"'`]*)["'`]/g);
  
  if (valueMatches) {
    for (let i = 0; i < valueMatches.length; i++) {
      const valueMatch = valueMatches[i];
      const matchResult = valueMatch.match(/(\w+):\s*["'`]([^"'`]*)["'`]/) || [];
      const key = matchResult[1];
      const classes = matchResult[2];
      if (key && classes) {
        values[key] = classes.trim();
      }
    }
  }
  
  return values;
}

function parseDefaultVariants(defaultStr: string): any {
  const defaults: any = {};
  
  const matches = defaultStr.match(/(\w+):\s*["'`]([^"'`]*)["'`]/g);
  
  if (matches) {
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const matchResult = match.match(/(\w+):\s*["'`]([^"'`]*)["'`]/) || [];
      const key = matchResult[1];
      const value = matchResult[2];
      if (key && value) {
        defaults[key] = value;
      }
    }
  }
  
  return defaults;
}

function generateBEMCSS(variants: any, componentPrefix: string): string {
  let css = `/* Generated BEM CSS from CVA variants */\n/* This file is auto-generated. Do not edit manually. */\n\n`;
  
  const variantKeys = Object.keys(variants);
  for (let i = 0; i < variantKeys.length; i++) {
    const variantKey = variantKeys[i];
    const variant = variants[variantKey];
    const componentName = variant.name.replace(/Variants?$/, '').toLowerCase();
    const prefixedName = componentPrefix ? `${componentPrefix}-${componentName}` : componentName;
    
    // Generate base component class
    css += `/* ${variant.name} */\n`;
    css += `.${prefixedName} {\n`;
    css += `  @apply ${variant.baseClasses};\n`;
    css += `}\n\n`;
    
    // Generate variant classes using BEM modifier syntax
    const configKeys = Object.keys(variant.config);
    for (let j = 0; j < configKeys.length; j++) {
      const variantType = configKeys[j];
      const variantValues = variant.config[variantType];
      const valueKeys = Object.keys(variantValues);
      
      for (let k = 0; k < valueKeys.length; k++) {
        const variantValueKey = valueKeys[k];
        const variantClasses = variantValues[variantValueKey];
        const bemClass = `.${prefixedName}--${variantValueKey}`;
        css += `${bemClass} {\n`;
        css += `  @apply ${variantClasses};\n`;
        css += `}\n\n`;
      }
    }
    
    // Generate combined variant classes for two-variant components
    if (configKeys.length === 2) {
      css += `/* Combined variants for ${prefixedName} */\n`;
      css += generateCombinedVariants(prefixedName, variant.config);
    }
  }
  
  return css;
}

function generateCombinedVariants(componentName: string, config: any): string {
  let css = '';
  const variantTypes = Object.keys(config);
  
  // Generate all possible combinations for two variants
  if (variantTypes.length === 2) {
    const type1 = variantTypes[0];
    const type2 = variantTypes[1];
    const values1 = Object.keys(config[type1]);
    const values2 = Object.keys(config[type2]);
    
    for (let i = 0; i < values1.length; i++) {
      const value1 = values1[i];
      for (let j = 0; j < values2.length; j++) {
        const value2 = values2[j];
        const selector = `.${componentName}--${value1}--${value2}`;
        const classes1 = config[type1][value1];
        const classes2 = config[type2][value2];
        
        css += `${selector} {\n`;
        css += `  @apply ${classes1} ${classes2};\n`;
        css += `}\n\n`;
      }
    }
  }
  
  return css;
}