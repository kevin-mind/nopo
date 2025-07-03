import { describe, expect, it } from "vitest";
import { Form } from "../src/form";

describe("Form", () => {
  it("creates a web component", () => {
    const element = new Form();
    expect(element).toBeInstanceOf(Form);
    expect(element.tagName.toLowerCase()).toBe('ui-form');
  });

  it("renders the correct content", async () => {
    const element = new Form();
    document.body.appendChild(element);
    
    // Wait for the component to render
    await element.updateComplete;
    
    const div = element.shadowRoot?.querySelector('div');
    expect(div?.textContent?.trim()).toBe('<FOrm!>');
    
    // Clean up
    document.body.removeChild(element);
  });
});
