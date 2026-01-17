import { describe, expect, it } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { Button } from "../src/components/button";

// Mock CSS imports
vi.mock("../src/lib/theme.css", () => ({}));

describe("Button Component", () => {
  it("renders with default props", () => {
    render(<Button>Test Button</Button>);
    expect(screen.getByText("Test Button")).toBeInTheDocument();
  });

  it("renders with different variants", () => {
    render(<Button variant="destructive">Delete</Button>);
    const button = screen.getByText("Delete");
    expect(button).toBeInTheDocument();
    expect(button).toHaveClass("bg-destructive");
  });

  it("renders with different sizes", () => {
    render(<Button size="sm">Small Button</Button>);
    const button = screen.getByText("Small Button");
    expect(button).toBeInTheDocument();
    expect(button).toHaveClass("h-8");
  });

  it("is disabled when disabled prop is true", () => {
    render(<Button disabled>Disabled Button</Button>);
    const button = screen.getByText("Disabled Button");
    expect(button).toBeDisabled();
  });

  it("applies custom className", () => {
    render(<Button className="custom-class">Custom Button</Button>);
    const button = screen.getByText("Custom Button");
    expect(button).toHaveClass("custom-class");
  });

  // Intentionally failing test to verify CI fix loop
  it("intentionally fails for testing CI fix loop", () => {
    expect(true).toBe(false);
  });
});
