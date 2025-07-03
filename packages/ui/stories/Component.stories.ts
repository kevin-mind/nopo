import type { Meta, StoryObj } from "@storybook/web-components";
import { html } from "lit";
import "../src/component.js";

const meta: Meta = {
  title: "Components/MoreComponent",
  component: "more-component",
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "An interactive component built with Lit Element that demonstrates click counting and custom events.",
      },
    },
  },
  argTypes: {
    name: {
      control: { type: "text" },
      description: "The name to display in the greeting",
      defaultValue: "World",
    },
    count: {
      control: { type: "number" },
      description: "The current count value",
      defaultValue: 0,
    },
  },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  args: {
    name: "World",
    count: 0,
  },
  render: (args) => html`
    <more-component
      name=${args.name}
      count=${args.count}
      @count-changed=${(e: CustomEvent) => {
        console.log("Count changed:", e.detail);
      }}
    ></more-component>
  `,
};

export const WithCustomName: Story = {
  args: {
    name: "Storybook",
    count: 0,
  },
  render: (args) => html`
    <more-component
      name=${args.name}
      count=${args.count}
      @count-changed=${(e: CustomEvent) => {
        console.log("Count changed for", args.name, ":", e.detail);
      }}
    ></more-component>
  `,
};

export const WithInitialCount: Story = {
  args: {
    name: "Counter",
    count: 5,
  },
  render: (args) => html`
    <more-component name=${args.name} count=${args.count}></more-component>
  `,
};

export const Interactive: Story = {
  args: {
    name: "Interactive",
    count: 0,
  },
  render: (args) => html`
    <div style="display: flex; gap: 1rem; flex-direction: column;">
      <more-component
        name=${args.name}
        count=${args.count}
        @count-changed=${(e: CustomEvent) => {
          console.log("Interactive component count changed:", e.detail);
        }}
      ></more-component>
      <more-component
        name="Second Component"
        count="10"
        @count-changed=${(e: CustomEvent) => {
          const target = e.target as HTMLElement;
          target.style.backgroundColor =
            target.style.backgroundColor === "lightblue"
              ? "lightgreen"
              : "lightblue";
        }}
      ></more-component>
    </div>
  `,
};

export const MultipleComponents: Story = {
  render: () => html`
    <div
      style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem;"
    >
      <more-component name="Alice" count="0"></more-component>
      <more-component name="Bob" count="3"></more-component>
      <more-component name="Charlie" count="7"></more-component>
      <more-component name="Diana" count="12"></more-component>
    </div>
  `,
};
