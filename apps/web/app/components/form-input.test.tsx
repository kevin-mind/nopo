import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FormInput } from "./form-input";

describe("FormInput Component", () => {
  it("renders with label", () => {
    render(<FormInput label="Email" />);
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("sets aria-describedby when description is provided", () => {
    render(
      <FormInput
        label="Password"
        description="Must be at least 8 characters"
      />,
    );
    const input = screen.getByLabelText("Password");
    expect(input).toHaveAttribute("aria-describedby");

    const descriptionId = input.getAttribute("aria-describedby");
    expect(descriptionId).toBeTruthy();

    const descriptionElement = document.getElementById(descriptionId!);
    expect(descriptionElement).toBeInTheDocument();
    expect(descriptionElement).toHaveTextContent(
      "Must be at least 8 characters",
    );
  });

  it("does not set aria-describedby when no description", () => {
    render(<FormInput label="Username" />);
    const input = screen.getByLabelText("Username");
    expect(input).not.toHaveAttribute("aria-describedby");
  });

  it("uses provided id when given", () => {
    render(<FormInput label="Name" id="custom-id" />);
    const input = screen.getByLabelText("Name");
    expect(input).toHaveAttribute("id", "custom-id");
  });

  it("applies custom className", () => {
    render(<FormInput label="Test" className="custom-class" />);
    const input = screen.getByLabelText("Test");
    expect(input).toHaveClass("custom-class");
  });

  it("passes through additional input props", () => {
    render(
      <FormInput
        label="Email"
        type="email"
        placeholder="Enter email"
        required
      />,
    );
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("type", "email");
    expect(input).toHaveAttribute("placeholder", "Enter email");
    expect(input).toBeRequired();
  });
});
