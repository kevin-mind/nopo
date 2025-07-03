import { describe, expect, it } from "vitest";
import { Component } from "../src/component";

describe("Component", () => {
  it("creates a web component", () => {
    const element = new Component();
    expect(element).toBeInstanceOf(Component);
    expect(element.tagName.toLowerCase()).toBe('ui-component');
  });

  it("renders the correct content", async () => {
    const element = new Component();
    document.body.appendChild(element);
    
    // Wait for the component to render
    await element.updateComplete;
    
    const div = element.shadowRoot?.querySelector('div');
    expect(div?.textContent?.trim()).toBe('Component');
    
    // Clean up
    document.body.removeChild(element);
  });
});
