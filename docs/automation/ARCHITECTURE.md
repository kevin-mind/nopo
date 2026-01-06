# Claude Automation Architecture

This document describes the fully automated development workflow powered by Claude agents and GitHub Actions.

## Overview

The repository is configured to use autonomous agents to handle the entire software development lifecycle, from issue creation to merging code.

### Core Workflows

1.  **Triage (`claude-triage.yml`)**

    - **Trigger:** New Issue opened.
    - **Action:** Claude analyzes the issue, adds labels (`bug`, `enhancement`, `needs-info`), breaks down requirements into a checklist, and assigns project/milestone if applicable.
    - **Goal:** Ensure issues are "ready" for implementation.

2.  **Implementation (`claude-implement.yml`)**

    - **Trigger:** Issue assigned to `claude` (or bot user).
    - **Action:** Claude creates a feature branch (`feat/issue-{number}`), writes the code, runs tests, pushes the branch, and opens a Pull Request.
    - **Goal:** Zero-touch implementation of specified features.

3.  **Code Review (`claude-review.yml`)**

    - **Trigger:** Pull Request opened or updated.
    - **Action:** Claude reviews the changes, providing specific feedback, security checks, and improvement suggestions.
    - **Goal:** Maintain code quality and standards defined in `CLAUDE.md`.

4.  **Response & Fix (`claude-respond.yml`)**

    - **Trigger:** Comment on Issue or PR containing `@claude`.
    - **Action:** Claude reads the comment context and code, implements requested fixes or answers questions, and pushes updates if necessary.
    - **Goal:** Interactive iteration on code.

5.  **CI Remediation (`claude-ci-fix.yml`)**

    - **Trigger:** CI workflow failure.
    - **Action:** Claude checks out the failing branch, runs tests locally to reproduce the error, fixes the code, and pushes the fix.
    - **Goal:** Self-healing builds.

6.  **Auto-Merge (`claude-merge.yml`)**
    - **Trigger:** PR approved.
    - **Action:** Automatically queues the PR for merge once all status checks pass.
    - **Goal:** Streamlined delivery.

## Configuration

- **`CLAUDE.md`**: The central brain. Defines coding conventions, build commands, and architectural patterns. Update this file to change how Claude writes code.
- **Secrets**: `ANTHROPIC_API_KEY` must be set in repository secrets.

## How to Use

1.  **Create an Issue**: Describe what you want. Claude will triage it.
2.  **Assign to Claude**: When the plan looks good, assign the issue to `claude`.
3.  **Wait for PR**: Claude will push code and open a PR.
4.  **Review**: Check the PR. Claude will have already reviewed it, but you can add your own comments. Mention `@claude` to ask for specific changes.
5.  **Merge**: Once approved, it will be merged automatically.
