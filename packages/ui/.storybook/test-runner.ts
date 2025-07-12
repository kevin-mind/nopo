import type { TestRunnerConfig } from "@storybook/test-runner";
import { toMatchImageSnapshot } from "jest-image-snapshot";

const config: TestRunnerConfig = {
  setup() {
    expect.extend({ toMatchImageSnapshot });
  },
  async postVisit(page, context) {
    // Take a screenshot for snapshot testing
    if (context.name === "AllVariants") {
      const screenshot = await page.screenshot();
      expect(screenshot).toMatchImageSnapshot({
        customSnapshotIdentifier: `${context.title.replace(/\//g, "-")}-${context.name}`,
        threshold: 0.2,
        thresholdType: "percent",
      });
    }
  },
  tags: {
    include: ["test"],
    exclude: ["!test"],
    skip: ["skip"],
  },
};

export default config;
