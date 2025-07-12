import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, within } from "@storybook/test";
import { Button } from "./button";

const meta = {
  title: "Components/Button",
  component: Button,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "A versatile button component with multiple variants and sizes.",
      },
    },
  },
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: { type: "select" },
      options: [
        "default",
        "destructive",
        "outline",
        "secondary",
        "ghost",
        "link",
      ],
      description: "The visual variant of the button",
    },
    size: {
      control: { type: "select" },
      options: ["default", "sm", "lg", "icon"],
      description: "The size of the button",
    },
    asChild: {
      control: { type: "boolean" },
      description:
        "Change the component to the HTML tag or custom component of the only child",
    },
    disabled: {
      control: { type: "boolean" },
      description: "Whether the button is disabled",
    },
    onClick: {
      action: "clicked",
      description: "Function called when the button is clicked",
    },
  },
  args: {
    onClick: fn(),
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

// Primary stories
export const Default: Story = {
  args: {
    children: "Button",
  },
};

export const Destructive: Story = {
  args: {
    variant: "destructive",
    children: "Delete",
  },
};

export const Outline: Story = {
  args: {
    variant: "outline",
    children: "Outline",
  },
};

export const Secondary: Story = {
  args: {
    variant: "secondary",
    children: "Secondary",
  },
};

export const Ghost: Story = {
  args: {
    variant: "ghost",
    children: "Ghost",
  },
};

export const Link: Story = {
  args: {
    variant: "link",
    children: "Link",
  },
};

// Size variants
export const Small: Story = {
  args: {
    size: "sm",
    children: "Small",
  },
};

export const Large: Story = {
  args: {
    size: "lg",
    children: "Large",
  },
};

export const Icon: Story = {
  args: {
    size: "icon",
    children: "🚀",
  },
};

// State variants
export const Disabled: Story = {
  args: {
    disabled: true,
    children: "Disabled",
  },
};

// Interaction testing story
export const WithInteractions: Story = {
  args: {
    children: "Click me!",
    "data-testid": "interactive-button",
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByTestId("interactive-button");

    // Test initial state
    await expect(button).toBeInTheDocument();
    await expect(button).toHaveTextContent("Click me!");
    await expect(button).not.toBeDisabled();

    // Test click interaction
    await userEvent.click(button);
    await expect(args.onClick).toHaveBeenCalledTimes(1);

    // Test focus interaction
    await userEvent.tab();
    await expect(button).toHaveFocus();

    // Test keyboard interaction (Space key)
    await userEvent.keyboard(" ");
    await expect(args.onClick).toHaveBeenCalledTimes(2);

    // Test keyboard interaction (Enter key)
    await userEvent.keyboard("[Enter]");
    await expect(args.onClick).toHaveBeenCalledTimes(3);
  },
};

// Multiple clicks test
export const MultipleClicks: Story = {
  args: {
    children: "Multiple clicks test",
    "data-testid": "multiple-clicks-button",
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByTestId("multiple-clicks-button");

    // Test multiple rapid clicks
    for (let i = 0; i < 5; i++) {
      await userEvent.click(button);
    }

    await expect(args.onClick).toHaveBeenCalledTimes(5);
  },
};

// Disabled interaction test
export const DisabledInteraction: Story = {
  args: {
    children: "Disabled button",
    disabled: true,
    "data-testid": "disabled-button",
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByTestId("disabled-button");

    // Test that disabled button doesn't respond to clicks
    await expect(button).toBeDisabled();
    await userEvent.click(button);
    await expect(args.onClick).not.toHaveBeenCalled();
  },
};

// All variants showcase for snapshot testing
export const AllVariants: Story = {
  render: () => (
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Variants</h3>
        <Button variant="default">Default</Button>
        <Button variant="destructive">Destructive</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="link">Link</Button>
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Sizes</h3>
        <Button size="sm">Small</Button>
        <Button size="default">Default</Button>
        <Button size="lg">Large</Button>
        <Button size="icon">🚀</Button>
      </div>
    </div>
  ),
  parameters: {
    snapshot: {
      delay: 100,
    },
  },
};
