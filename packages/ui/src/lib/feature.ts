/**
 * Converts a string to a URL-friendly slug.
 *
 * @param text - The input string to convert
 * @returns A lowercase, hyphen-separated string safe for URLs
 *
 * @example
 * slugify("Hello World") // "hello-world"
 * slugify("  Multiple   Spaces  ") // "multiple-spaces"
 * slugify("Special @#$ Characters!") // "special-characters"
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "") // Remove special characters
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .replace(/-+/g, "-") // Collapse multiple hyphens
    .replace(/^-|-$/g, ""); // Remove leading/trailing hyphens
}
