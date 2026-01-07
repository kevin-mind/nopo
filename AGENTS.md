# AGENTS.md - Nopo Project Guidelines

This document provides comprehensive guidance for AI coding agents working on the Nopo monorepo. Nopo (mo**no**re**po**) is a Docker-based development environment with a custom CLI for managing services, featuring a Django backend, React Router frontend, and infrastructure-as-code for GCP and Fly.io deployments.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Getting Started](#getting-started)
3. [Command Reference](#command-reference)
4. [Development Workflow](#development-workflow)
5. [Testing Philosophy](#testing-philosophy)
6. [Code Quality](#code-quality)
7. [Database & Migrations](#database--migrations)
8. [Pull Request Guidelines](#pull-request-guidelines)
9. [CI/CD Pipeline](#cicd-pipeline)
10. [Architecture & Documentation](#architecture--documentation)
11. [Conventions & Patterns](#conventions--patterns)
12. [Tripwires & Anti-patterns](#tripwires--anti-patterns)
13. [Claude Automation State Machine](#claude-automation-state-machine)

---

## Project Overview

### Repository Structure

```
nopo/
├── apps/                      # Application services
│   ├── backend/              # Django REST API (Python 3.12+)
│   ├── web/                  # React Router frontend (TypeScript)
│   ├── db/                   # PostgreSQL database config
│   └── nginx/                # Nginx reverse proxy config
├── packages/                  # Shared packages
│   ├── configs/              # Shared ESLint, TypeScript, Vite configs
│   ├── plop/                 # Code generators
│   └── ui/                   # Shared React UI components (Storybook)
├── nopo/                      # CLI tool
│   ├── scripts/              # TypeScript CLI implementation
│   ├── docker/               # Base Docker configuration
│   └── docs/                 # CLI documentation
├── infrastructure/            # GCP Terraform configs
├── fly/                       # Fly.io deployment configs
├── decisions/                 # Architecture Decision Records (ADRs)
└── .github/                   # GitHub Actions workflows
```

### Key Technologies

| Layer          | Technologies                                                  |
| -------------- | ------------------------------------------------------------- |
| Frontend       | React 19, React Router 7, TypeScript, Vite, Tailwind CSS      |
| Backend        | Django 5, Django REST Framework, Python 3.12+, Gunicorn       |
| Database       | PostgreSQL 16                                                 |
| Build Tools    | pnpm 10.11+, uv (Python), Docker, Docker Compose, Buildx Bake |
| Testing        | Vitest (unit), Playwright (e2e), Storybook (visual)           |
| Linting        | ESLint 9, Prettier, Ruff (Python), mypy                       |
| Infrastructure | Terraform, GCP (Cloud Run, Cloud SQL), Fly.io                 |
| CI/CD          | GitHub Actions                                                |

---

## Getting Started

### Prerequisites

- Node.js 22.16+
- pnpm 10.11+
- Docker and Docker Compose v2.20+
- Python 3.12+ (for backend development)
- uv (Python package manager)

### Initial Setup

```bash
# Install dependencies and see CLI help
make

# Set up environment variables
make env

# Build Docker images
make build

# Start all services
make up

# Access the application at http://localhost
```

---

## Command Reference

### Primary Interface: Make Commands

**Always prefer `make <command> -- <args>` for nopo CLI operations.** The Makefile routes commands to the nopo CLI.

```bash
# Core commands
make                          # Install deps + show nopo CLI help
make build                    # Build all Docker images
make build backend web        # Build specific services
make up                       # Start all services (auto-builds if needed)
make up backend               # Start specific service
make down                     # Stop all services
make pull                     # Pull images from registry
make status                   # Check service status
make list                     # List discovered services
make list -- --json           # Machine-readable output
make shell backend            # Shell into backend container

# Arbitrary commands (forwarded to pnpm)
make test                     # Run tests
make check                    # Run linting/type checks
make lint                     # Run linting
make fix                      # Auto-fix linting issues

# Configuration
make config validate -- --json --services-only
```

### Direct Tool Commands

Use pnpm and uv directly when working with specific packages:

```bash
# JavaScript/TypeScript packages
pnpm install                          # Install all dependencies
pnpm run -r build                     # Build all workspaces
pnpm run --filter @more/ui test       # Test specific package
pnpm run --filter @more/backend lint  # Lint specific package

# Python packages (backend)
uv sync --frozen                      # Sync Python dependencies
uv run python manage.py test          # Run Django tests
uv run python manage.py migrate       # Run migrations
uv tool run ruff check                # Run Python linter

# Docker Compose
docker compose up -d                  # Start services in background
docker compose logs -f backend        # Follow backend logs
docker compose exec backend bash      # Shell into running container
```

### Service-Specific Commands (from nopo.yml)

Each service defines commands in its `nopo.yml`:

```bash
# Backend (apps/backend)
make test backend             # Run Django tests
make check backend            # Run ruff + eslint + mypy + tsc
make dev backend              # Start dev server + vite
make migrate backend          # Run migrations

# Web (apps/web)
make dev web                  # Start React Router dev server
make check web                # Run TypeScript type checking
make compile web              # Build for production
```

---

## Development Workflow

### Test-Driven Development (TDD) Pattern

All changes should follow this TDD workflow:

#### 1. Create a Plan Document

Before implementing any significant feature, create `plan-<feature>.md`:

```markdown
# Plan: <Feature Name>

## Overview

Brief description of what this feature does and why it's needed.

## Requirements

- [ ] Requirement 1
- [ ] Requirement 2

## Technical Approach

Description of how we'll implement this.

## Tasks

- [ ] Task 1
- [ ] Task 2

## Tripwires

Signs we're going down the wrong path:

- If we need to modify more than X files...
- If tests require excessive mocking...
- If the change breaks existing tests unexpectedly...

## Success Criteria

How we know we're done:

- All tests pass
- No increase in test execution time > X%
- Documentation updated
```

#### 2. Write Tests First

```bash
# Create test file
# tests should cover API input/output, NOT implementation details

# Run tests - they should FAIL initially
make test backend
pnpm run --filter @more/ui test
```

#### 3. Verify Expected Failures

Ensure tests fail for the right reasons - they should fail because the feature doesn't exist, not because of test errors.

#### 4. Implement Until Tests Pass

```bash
# Iterate on implementation
make test backend

# Once passing, run full check
make check
make test
```

---

## Testing Philosophy

### Core Principles

1. **Test the API, not the implementation** - Tests should verify inputs and outputs, not internal details
2. **Minimize mocking** - Mock as little as possible; prefer integration tests
3. **Integration first, unit second** - Test at the integration layer first; use unit tests for what can't be covered there
4. **E2E for critical user flows** - Playwright tests for essential user journeys

### Test Hierarchy

```
Integration Tests (preferred)
    └── Cover API endpoints, database interactions
    └── Minimal mocking, real dependencies where possible

Unit Tests (supplementary)
    └── Cover logic that can't be integration tested
    └── Pure functions, utility code

E2E Tests (critical paths)
    └── Cover essential user flows
    └── Page Object Model pattern
```

### Backend Testing (Django)

```python
# Good: Test API input/output
class TestUserAPI(TestCase):
    def test_create_user_returns_201(self):
        response = self.client.post('/api/users/', {'name': 'Test'})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()['name'], 'Test')

# Bad: Test implementation details
class TestUserAPI(TestCase):
    def test_create_user_calls_save(self):
        with mock.patch.object(User, 'save') as mock_save:
            self.client.post('/api/users/', {'name': 'Test'})
            mock_save.assert_called_once()  # Too coupled to implementation
```

### Frontend Testing (Vitest)

```typescript
// Good: Test component behavior
test('button calls onClick when clicked', async () => {
  const onClick = vi.fn();
  render(<Button onClick={onClick}>Click me</Button>);
  await userEvent.click(screen.getByRole('button'));
  expect(onClick).toHaveBeenCalledOnce();
});

// Bad: Test implementation details
test('button has correct internal state', () => {
  // Don't test internal state, test observable behavior
});
```

### E2E Testing (Playwright)

Use Page Object Model pattern:

```typescript
// pages/HomePage.ts
export class HomePage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto("/");
  }

  async getHeading() {
    return this.page.getByRole("heading", { level: 1 });
  }

  async clickGetStarted() {
    await this.page.getByTestId("get-started-btn").click();
  }
}

// tests/user-flow.spec.ts
test("user can complete onboarding", async ({ page }) => {
  const homePage = new HomePage(page);
  const onboardingPage = new OnboardingPage(page);

  await homePage.goto();
  await homePage.clickGetStarted();
  await onboardingPage.fillForm({ name: "Test User" });
  await onboardingPage.submit();

  await expect(page.getByText("Welcome, Test User")).toBeVisible();
});
```

**E2E Element Selection Priority:**

1. `data-testid` attributes for test-specific elements
2. Accessible roles (`getByRole`)
3. Text content (`getByText`)
4. Never use implementation-specific selectors (CSS classes, DOM structure)

### Running Tests

```bash
# All tests
make test

# Backend tests
make test backend
# or inside backend container:
uv run python manage.py test src

# Frontend tests
pnpm run --filter @more/ui test

# E2E tests (smoketest)
make smoketest
# or with custom URL:
PUBLIC_URL=https://stage.example.com pnpm run smoketest
```

---

## Code Quality

### Pre-commit Checklist

**Always run before pushing:**

```bash
make check    # Lint + type check all code
make test     # Run all tests
```

### Linting & Formatting

```bash
# Check all
make check

# Fix auto-fixable issues
make fix

# Specific tools
pnpm run check:lint:root     # ESLint at root
pnpm run check:types:root    # TypeScript at root
pnpm run check:knip:root     # Dead code detection
uv tool run ruff check       # Python linting
uv run mypy .                # Python type checking
```

### TypeScript Conventions

- Use strict mode (`strict: true` in tsconfig)
- Prefer `interface` over `type` for object shapes
- Use `unknown` over `any` when type is truly unknown
- Co-locate types with their usage

### Python Conventions

- Follow PEP 8 (enforced by Ruff)
- Use type hints everywhere
- Django: follow Django coding style

---

## Database & Migrations

### Expand-Contract Migration Pattern

**All data migrations must follow the expand-contract method:**

#### Phase 1: Expand

Add new fields/tables without removing old ones:

```python
# Migration: Add new field
class Migration(migrations.Migration):
    operations = [
        migrations.AddField(
            model_name='user',
            name='new_email',
            field=models.EmailField(null=True),
        ),
    ]
```

#### Phase 2: Transform

Write to both old and new locations:

```python
# Application code: Write to both
user.email = new_email  # Old field
user.new_email = new_email  # New field
```

#### Phase 3: Switch

Change reads to use new field:

```python
# Application code: Read from new
email = user.new_email or user.email
```

#### Phase 4: Contract

Remove old field (only after all consumers updated):

```python
# Migration: Remove old field (separate PR!)
class Migration(migrations.Migration):
    operations = [
        migrations.RemoveField(model_name='user', name='email'),
        migrations.RenameField(model_name='user', old_name='new_email', new_name='email'),
    ]
```

### Critical Migration Rules

1. **Migrations and code changes must be in separate PRs** - Never combine schema changes with application code changes
2. **Migrations must be self-contained** - Any code executed in a migration must be defined within the migration file itself
3. **Test migrations locally first** - `make migrate backend`
4. **Check for pending migrations** - `make migrate:check backend`

### Migration Commands

```bash
# Create new migration
make makemigrations backend

# Apply migrations
make migrate backend

# Check for pending migrations
uv run python manage.py migrate --check

# Show migration status
uv run python manage.py showmigrations
```

---

## Pull Request Guidelines

### Size Limits

- **Target: < 500 lines of change**
- **Commits: 1-2 per PR**
- If a change grows larger, break it into incremental PRs

### PR Description Template

```markdown
## Summary

Brief description of what this PR does.

## Why

Explanation of why this change is needed.

## Changes

- Change 1
- Change 2

## Testing

How to test this change manually:

1. Step 1
2. Step 2

## Checklist

- [ ] Tests added/updated
- [ ] Documentation updated (if applicable)
- [ ] `make check` passes
- [ ] `make test` passes
```

### Commit Message Format

```
<type>: <short description>

<longer description if needed>
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`

### Before Opening PR

```bash
# 1. Ensure tests pass
make test

# 2. Ensure linting passes
make check

# 3. Rebase on main if needed
git fetch origin
git rebase origin/main

# 4. Squash to 1-2 commits if needed
git rebase -i origin/main
```

---

## CI/CD Pipeline

### Automated Pipeline

CI is fully automated. Push a branch, create a PR, and:

1. Build runs automatically
2. Tests run automatically
3. Linting runs automatically
4. Deployment to staging (on merge to main)
5. Deployment to production (after staging success)

### Merge Process

```bash
# Create PR and queue for merge
gh pr create --fill
gh pr merge --auto --squash
```

**Manual work in CI/deployment is a code smell.** If you find yourself doing manual steps, consider automating them.

### CI Commands

```bash
# Check CI status
gh pr checks

# View workflow runs
gh run list

# Re-run failed checks
gh run rerun <run-id>
```

---

## Architecture & Documentation

### When to Update Documentation

Update documentation when making:

- Significant architectural changes
- New service additions
- API changes
- Configuration changes
- New patterns or conventions

### Documentation Locations

| Type                   | Location                         |
| ---------------------- | -------------------------------- |
| Architecture decisions | `decisions/` (ADR format)        |
| CLI documentation      | `nopo/docs/`                     |
| Infrastructure         | `infrastructure/ARCHITECTURE.md` |
| Service-specific       | `apps/<service>/README.md`       |

### Creating Architecture Decision Records

```bash
# Copy template
cp decisions/template.md decisions/NNNN_<topic>.md

# Edit with:
# - Context: What problem are we solving?
# - Decision: What did we decide?
# - Consequences: What are the trade-offs?
```

---

## Conventions & Patterns

### Package Naming

- NPM packages: `@more/<name>` (e.g., `@more/backend`, `@more/ui`)
- Python packages: workspace members without prefix

### Script Naming Convention

```
<script>:workspace  - Runs on all workspace packages
<script>:root       - Runs at project root
<script> (bare)     - Runs both via regex pattern matching
```

### Environment Variables

| Variable        | Purpose                       |
| --------------- | ----------------------------- |
| `SERVICE_NAME`  | Current service context       |
| `DOCKER_TAG`    | Full Docker image tag         |
| `DOCKER_TARGET` | `development` or `production` |
| `NODE_ENV`      | Node environment              |

### Be Eventually DRY

- **It's okay to duplicate initially** - Duplication measures reusability
- **Rule of thumb: 3+ instances = consider abstracting**
- When abstracting, prefer composition over inheritance

---

## Tripwires & Anti-patterns

### Signs You're Going Wrong

1. **Excessive mocking in tests** - If you need to mock many dependencies, reconsider the architecture
2. **PR > 500 lines** - Break it up into smaller changes
3. **Migrations + code in same PR** - Separate them
4. **Manual CI/deployment steps** - Automate them
5. **Tests checking implementation details** - Test behavior, not internals
6. **Modifying > 10 files for a simple feature** - Architecture may need refactoring

### Common Mistakes to Avoid

```bash
# DON'T: Run production build during development
make build -- --target=production

# DO: Use development mode
make up

# DON'T: Combine migrations with code changes
git add migrations/ src/
git commit -m "Add feature with migration"

# DO: Separate PRs
# PR 1: Migration only
# PR 2: Code changes only

# DON'T: Push without testing
git push

# DO: Test first
make check && make test && git push

# DON'T: Create giant PRs
# 1500 lines of changes

# DO: Incremental changes
# PR 1: Add data model (200 lines)
# PR 2: Add API endpoint (150 lines)
# PR 3: Add UI (200 lines)
```

### When to Ask for Help

- Architectural decisions affecting multiple services
- Changes to CI/CD pipeline
- Database migrations affecting production data
- Security-sensitive changes

---

## Claude Automation State Machine

This project uses Claude AI agents for automated issue management with issue-based triggers. Race conditions between CI-fix and review loops are prevented using draft/ready PR states.

### Overall Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌──────────┐
│   TRIAGE    │────►│  IMPLEMENT  │────►│   CI LOOP   │────►│   REVIEW    │────►│   DONE   │
│             │     │             │     │   (draft)   │     │    LOOP     │     │          │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘     └──────────┘
      │                   │                   │                   │                   │
      ▼                   ▼                   ▼                   ▼                   ▼
 Issue opened       Assigned to         CI fix loop        Review cycle        Human merges
 or edited          claude[bot]         until green        until approved
```

### Draft/Ready State Machine

PR state controls which automation loops can run, preventing race conditions. CI is the gatekeeper between the two loops:

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                     │
│  ┌───────────────────────────────────────┐    ┌───────────────────────────────────┐ │
│  │            CI LOOP (draft)            │    │        REVIEW LOOP (ready)        │ │
│  │                                       │    │                                   │ │
│  │         IMPLEMENT                     │    │                  ┌─────────────┐  │ │
│  │             │                         │    │     no commits   │   REVIEW    │  │ │
│  │             │ create draft PR         │    │   ┌─────────────►│             │  │ │
│  │             ▼                         │    │   │    ┌────────►│  submitted  │  │ │
│  │  ┌─────────────┐                      │    │   │    │         └──────┬──────┘  │ │
│  │  │     CI      │                      │    │   │    │                │         │ │
│  │  │   RUNNING   │──────────────────────┼────┼───┼────┘                ▼         │ │
│  │  │             │  pass: ready +       │    │   │  request     ┌─────────────┐  │ │
│  │  └──────┬──────┘     request review   │    │   │  review      │  RESPONSE   │  │ │
│  │         │                             │    │   │              │             │  │ │
│  │         │ fail                        │    │   └──────────────│ commits? ───┼───┼──┐
│  │         ▼                             │    │                  │             │  │ │  │
│  │  ┌─────────────┐                      │    │                  └─────────────┘  │ │  │
│  │  │  CI-FIX     │                      │    │                                   │ │  │
│  │  │             │                      │    │                                   │ │  │
│  │  │ fix & push  │───┐                  │    │                                   │ │  │
│  │  └─────────────┘   │                  │    │                                   │ │  │
│  │         ▲          │                  │    │                                   │ │  │
│  │         └──────────┘                  │    │                                   │ │  │
│  │                                       │    │                                   │ │  │
│  └───────────────────────────────────────┘    └───────────────────────────────────┘ │  │
│            ▲                                                                        │  │
│            │                        yes: convert to draft & push                    │  │
│            └────────────────────────────────────────────────────────────────────────┘  │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

**Two loops, one gateway:**
1. **CI Loop** (draft PRs): `push → CI → fail → CI-fix → push` (repeats until green)
2. **Review Loop** (ready PRs): `review → response` with two paths:
   - **No commits** (questions/discussion): re-request review → stays in review loop
   - **Has commits** (changes made): convert to draft → push → CI loop
3. **CI is the bridge**: Only code changes go through CI; pure discussion stays in review loop

### Triggers

| Action | Trigger | Condition |
|--------|---------|-----------|
| **Triage** | `issues: [opened, edited]` | No "triaged" label |
| **Implement** | `issues: [assigned]` | Assigned to `claude[bot]` |
| **CI Fix** | `workflow_run: [completed]` | CI failed, Claude PR |
| **CI Pass** | `workflow_run: [completed]` | CI passed, Claude PR |
| **Review** | `pull_request: [review_requested]` | Reviewer is `claude[bot]`, PR is ready |
| **Review Response** | `pull_request_review: [submitted]` | Review by `claude[bot]`, PR is ready |

### Review Loop Details

The review loop only operates on **ready** PRs:

1. **claude-review.yml** (triggered by `review_requested`)
   - Checks existing review comments
   - Resolves completed threads
   - Reviews code against issue requirements
   - Submits batch review (approve, request changes, or comment)

2. **claude-review-response.yml** (triggered by review submission)
   - Processes change requests from the review
   - Two paths based on whether commits were made:
     - **Has commits**: Convert to draft → push → CI loop takes over
     - **No commits** (discussion only): Re-request review → stays in review loop

3. **Loop exits** when Claude approves the PR

### Human Gates

These actions **require human intervention**:

1. **Assign to Claude**: Triggers implementation
2. **Request Claude as reviewer**: Triggers review loop
3. **Merge PR**: Only humans can merge approved PRs

### Workflows

| Workflow | File | Trigger |
|----------|------|---------|
| Triage | `claude-triage.yml` | Issue opened/edited without "triaged" label |
| Implement | `claude-implement.yml` | Issue assigned to `claude[bot]` |
| CI Fix | `claude-ci-fix.yml` | CI failure (converts Claude PR to draft, fixes, pushes) |
| CI Pass | `claude-ci-pass.yml` | CI success (converts Claude PR to ready, adds label) |
| Review | `claude-review.yml` | `claude[bot]` requested as reviewer (ready PRs only) |
| Review Response | `claude-review-response.yml` | `claude[bot]` submits review (ready PRs only) |

### Agent Responsibilities

| Agent | Actions |
|-------|---------|
| **Triage** | Labels, links similar issues, expands context, answers questions, adds "triaged" label |
| **Implement** | Creates branch, implements todos, runs tests, creates draft PR with "Fixes #N" |
| **CI-Fix** | Converts to draft → fixes code → pushes → CI runs again. Human PRs: suggest fixes via comments |
| **CI-Pass** | Converts to ready → adds "review-ready" label → requests Claude review → updates project status |
| **Review** | Resolves completed threads, reviews code, submits batch review (ready PRs only) |
| **Review Response** | Processes comments: if commits → draft + push (CI loop); if no commits → re-request review (stays in review loop) |

### PR Requirements

All PRs created by Claude automation must:

1. Include `Fixes #N` in the body to link to the issue
2. Pass CI checks before review
3. Have all issue todos addressed
4. Have no unresolved review comments
5. Be approved by Claude before human merge

### Setup Requirements

1. **CLAUDE_CODE_OAUTH_TOKEN secret**: OAuth token for Claude (uses subscription)
2. **PROJECT_TOKEN secret** (optional): Fine-grained PAT with `project:write` for updating project status
3. **GitHub Project** (optional): Project board with Status field - status updated via GraphQL if issue is linked

---

## Quick Reference Card

```bash
# Daily Development
make up                    # Start services
make shell backend         # Shell into container
make test                  # Run tests
make check                 # Lint + type check

# Before PR
make check && make test    # Full validation

# Debugging
make status                # Check service status
docker compose logs -f     # View logs

# Database
make migrate backend       # Run migrations
make makemigrations backend # Create migration

# E2E Testing
make smoketest             # Run Playwright tests
```

---

_This document should be kept up-to-date as the project evolves. When making significant changes, update the relevant sections._
