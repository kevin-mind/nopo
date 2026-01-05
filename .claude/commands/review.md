---
description: Review the current branch against main for issues, missing tests, and gotchas
allowed-tools: Bash, Read, Grep, Glob
---

# Code Review Task

Review the current branch against main to identify issues, missing tests, flaws, and potential gotchas before merging.

## Instructions

### 1. Gather Context

First, understand what changed in this branch:

```bash
# Get the branch name
git branch --show-current

# See all commits in this branch not in main
git log main..HEAD --oneline

# Get a summary of changes
git diff main --stat

# See the actual diff
git diff main
```

### 2. Check PR Size

Verify the PR follows size guidelines:

- **Target: < 500 lines of change**
- **Commits: 1-2 per PR**

If the PR is too large, suggest how to split it into smaller, incremental PRs.

### 3. Review for Common Issues

Check for these anti-patterns:

**Code Quality:**

- [ ] Unused imports or variables
- [ ] Console.log statements left in code
- [ ] TODO comments without linked issues
- [ ] Magic numbers without constants
- [ ] Missing error handling
- [ ] Type safety issues (any, unknown without validation)

**Architecture:**

- [ ] Business logic in presentation layer
- [ ] Direct database calls from UI components
- [ ] Circular dependencies
- [ ] Breaking changes to public APIs

**Security:**

- [ ] Secrets or credentials in code
- [ ] SQL injection vulnerabilities
- [ ] XSS vulnerabilities
- [ ] Missing input validation

### 4. Check Testing

**If code changes exist:**

```bash
# Check if tests exist for modified files
git diff main --name-only | grep -E '\.(ts|tsx|py)$' | grep -v '\.test\.' | grep -v '\.spec\.'
```

For each modified file, verify:

- [ ] Integration tests exist for API endpoints
- [ ] Unit tests exist for utility functions
- [ ] E2E tests exist for critical user flows

**Missing tests are a blocker** - suggest what tests should be added.

### 5. Check Migrations

If migrations exist, verify:

```bash
# Check for migration files
git diff main --name-only | grep -i migration
```

- [ ] Migrations are in a **separate PR** from code changes
- [ ] Migrations use expand-contract pattern
- [ ] Migrations are self-contained (no external code dependencies)

### 6. Verify CI Checks Pass

```bash
# Run linting
make check

# Run tests
make test
```

All checks must pass before merge.

### 7. Documentation Check

If significant changes were made:

- [ ] CLAUDE.md updated if workflow changed
- [ ] README.md updated if setup changed
- [ ] ADR created for architectural decisions
- [ ] API documentation updated if endpoints changed

## Output Format

Provide a structured review with:

### Summary

Brief description of what this PR does.

### Issues Found

List any problems that must be fixed before merge.

### Suggestions

Optional improvements that could be made.

### Missing Tests

Specific tests that should be added.

### Gotchas

Things to watch out for when deploying or maintaining this code.

### Verdict

- **APPROVE**: Ready to merge
- **REQUEST CHANGES**: Issues must be fixed first
- **NEEDS DISCUSSION**: Architectural decisions need team input

$ARGUMENTS
