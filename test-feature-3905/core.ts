/**
 * @module test-feature-3905/core
 *
 * Core logic for E2E test feature #3905.
 * Implements mock functionality to validate the Claude automation state machine.
 *
 * This module provides utilities for managing feature configuration and
 * executing phases in the automation workflow. It serves as a synthetic
 * test case for validating multi-phase issue processing.
 *
 * @example
 * ```typescript
 * import { getDefaultConfig, processAllPhases } from './core';
 *
 * const config = getDefaultConfig();
 * const results = processAllPhases();
 * console.log(`Processed ${results.length} phases`);
 * ```
 */

import {
  DEFAULT_TIMEOUT,
  FEATURE_NAME,
  FEATURE_VERSION,
  MAX_RETRIES,
  Phase,
  PHASES,
} from "./constants";

/**
 * Configuration options for the test feature.
 * @interface
 */
export interface FeatureConfig {
  /** The unique name identifier for the feature */
  name: string;
  /** Semantic version string (e.g., "1.0.0") */
  version: string;
  /** Operation timeout in milliseconds */
  timeout: number;
  /** Maximum number of retry attempts on failure */
  maxRetries: number;
}

/**
 * Result of executing a phase operation.
 * @interface
 */
export interface FeatureResult {
  /** Whether the phase completed successfully */
  success: boolean;
  /** The phase that was executed */
  phase: Phase;
  /** Human-readable status message */
  message: string;
  /** Unix timestamp when the phase completed */
  timestamp: number;
}

/**
 * Get the default configuration for the test feature.
 *
 * Returns a configuration object populated with values from constants.
 *
 * @returns The default feature configuration
 * @see {@link FeatureConfig}
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
 * Type guard to validate that a string is a valid phase.
 *
 * @param phase - The string to validate
 * @returns True if the phase is valid, false otherwise
 * @see {@link Phase}
 */
export function isValidPhase(phase: string): phase is Phase {
  return PHASES.includes(phase as Phase);
}

/**
 * Get the next phase in the workflow sequence.
 *
 * Phases follow the order: setup → implementation → finalization.
 *
 * @param currentPhase - The current phase in the workflow
 * @returns The next phase, or undefined if at the final phase
 */
export function getNextPhase(currentPhase: Phase): Phase | undefined {
  const currentIndex = PHASES.indexOf(currentPhase);
  if (currentIndex === -1 || currentIndex >= PHASES.length - 1) {
    return undefined;
  }
  return PHASES[currentIndex + 1];
}

/**
 * Execute a mock phase operation.
 *
 * This is a simulated operation that always succeeds for valid phases.
 * In a real implementation, this would perform actual work.
 *
 * @param phase - The phase to execute
 * @returns The result of the phase execution
 * @see {@link FeatureResult}
 */
export function executePhase(phase: Phase): FeatureResult {
  if (!isValidPhase(phase)) {
    return {
      success: false,
      phase,
      message: `Invalid phase: ${phase}`,
      timestamp: Date.now(),
    };
  }

  return {
    success: true,
    phase,
    message: `Phase "${phase}" completed successfully`,
    timestamp: Date.now(),
  };
}

/**
 * Process all phases in sequence.
 *
 * Executes each phase in order: setup, implementation, finalization.
 *
 * @returns An array of results for each phase execution
 * @see {@link executePhase}
 */
export function processAllPhases(): FeatureResult[] {
  return PHASES.map((phase) => executePhase(phase));
}
