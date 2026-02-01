/**
 * @module test-feature-4330/core
 *
 * Core logic for E2E test feature #4330.
 * Implements validation functionality for the Claude automation pipeline.
 *
 * This module provides utilities for managing feature configuration and
 * executing validation stages in the automation workflow.
 */

import {
  DEFAULT_TIMEOUT,
  FEATURE_NAME,
  FEATURE_VERSION,
  MAX_RETRIES,
  Stage,
  STAGES,
} from "./constants";

/**
 * Configuration options for the test feature.
 */
export interface FeatureConfig {
  /** The unique name identifier for the feature */
  name: string;
  /** Semantic version string */
  version: string;
  /** Operation timeout in milliseconds */
  timeout: number;
  /** Maximum number of retry attempts on failure */
  maxRetries: number;
}

/**
 * Result of executing a stage operation.
 */
export interface StageResult {
  /** Whether the stage completed successfully */
  success: boolean;
  /** The stage that was executed */
  stage: Stage;
  /** Human-readable status message */
  message: string;
  /** Unix timestamp when the stage completed */
  timestamp: number;
}

/**
 * Get the default configuration for the test feature.
 */
export function getDefaultConfig(): FeatureConfig {
  return {
    name: FEATURE_NAME,
    version: FEATURE_VERSION,
    timeout: DEFAULT_TIMEOUT,
    maxRetries: MAX_RETRIES,
  };
}

/**
 * Type guard to validate that a string is a valid stage.
 */
export function isValidStage(stage: string): stage is Stage {
  return STAGES.includes(stage as Stage);
}

/**
 * Get the next stage in the workflow sequence.
 *
 * Stages follow the order: init -> validate -> complete.
 */
export function getNextStage(currentStage: Stage): Stage | undefined {
  const currentIndex = STAGES.indexOf(currentStage);
  if (currentIndex === -1 || currentIndex >= STAGES.length - 1) {
    return undefined;
  }
  return STAGES[currentIndex + 1];
}

/**
 * Execute a stage operation.
 */
export function executeStage(stage: Stage): StageResult {
  if (!isValidStage(stage)) {
    return {
      success: false,
      stage,
      message: `Invalid stage: ${stage}`,
      timestamp: Date.now(),
    };
  }

  return {
    success: true,
    stage,
    message: `Stage "${stage}" completed successfully`,
    timestamp: Date.now(),
  };
}

/**
 * Process all stages in sequence.
 */
export function processAllStages(): StageResult[] {
  return STAGES.map((stage) => executeStage(stage));
}
