/**
 * Core logic for E2E test feature #3905
 * Implements mock functionality to validate the Claude automation state machine.
 */

import {
  DEFAULT_TIMEOUT,
  FEATURE_NAME,
  FEATURE_VERSION,
  MAX_RETRIES,
  Phase,
  PHASES,
} from "./constants";

export interface FeatureConfig {
  name: string;
  version: string;
  timeout: number;
  maxRetries: number;
}

export interface FeatureResult {
  success: boolean;
  phase: Phase;
  message: string;
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
 * Validate that a phase is valid.
 */
export function isValidPhase(phase: string): phase is Phase {
  return PHASES.includes(phase as Phase);
}

/**
 * Get the next phase in the workflow.
 * Returns undefined if already at the final phase.
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
 */
export function processAllPhases(): FeatureResult[] {
  return PHASES.map((phase) => executePhase(phase));
}
