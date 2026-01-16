---
description: Analyze codebase for dead code, redundancy, and cleanup opportunities
allowed-tools: Bash, Read, Grep, Glob, Edit
---

# Codebase Cleanup Task

Analyze the codebase for dead code, redundancy, non-DRY patterns, outdated dependencies, and missing tests. Then clean up and improve the codebase.

## Instructions

### 1. Dead Code Analysis

Run the following commands to identify dead code:

```bash
# Check for unused exports and dependencies
nopo check root -- knip
```

Review the output and:

- Remove unused exports
- Remove unused dependencies from package.json
- Remove unused files
- Clean up orphaned imports

### 2. Dependency Audit

Check for outdated and security issues:

```bash
# Check for outdated packages
pnpm outdated

# Check for security vulnerabilities
pnpm audit
```

Update dependencies that:

- Have security vulnerabilities (critical/high)
- Are significantly out of date (major version behind)
- Have deprecated warnings

**Be cautious**: Run `make check && make test` after updating to ensure nothing breaks.

### 3. DRY Analysis

Search for patterns that appear more than 2-3 times and could be abstracted:

- Repeated code blocks in components
- Duplicated utility functions
- Similar API handlers
- Repeated test setup code

For each pattern found:

- If 3+ occurrences: Consider abstracting into a shared utility
- If 2 occurrences: Leave as-is (duplication is acceptable)
- Create shared utilities in `packages/` if they cross app boundaries

### 4. Test Coverage Analysis

Identify areas lacking test coverage:

```bash
# Run tests with coverage
make test
```

Look for:

- Files with 0% coverage
- Critical paths without E2E tests
- API endpoints without integration tests
- Utility functions without unit tests

Add missing tests following the project's testing philosophy:

- Integration tests for API endpoints
- Unit tests for pure utility functions
- E2E tests for critical user flows

### 5. Code Quality Fixes

Run linting and fix issues:

```bash
# Fix auto-fixable issues
make fix

# Check for remaining issues
make check
```

### 6. Cleanup Artifacts

Remove build artifacts and cache:

```bash
make clean
```

## Output

Provide a summary of:

- Dead code removed (files, exports, dependencies)
- Dependencies updated (with versions)
- DRY improvements made (patterns abstracted)
- Tests added (files, coverage improvement)
- Linting issues fixed
- Any manual review items that couldn't be automated

## Safety Checklist

Before completing, ensure:

- [ ] `make check` passes
- [ ] `make test` passes
- [ ] No breaking changes to public APIs
- [ ] Changes are incremental (not too large for one PR)

$ARGUMENTS
