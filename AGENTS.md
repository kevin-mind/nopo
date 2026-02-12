# AGENTS.md - Nopo Project Guidelines

Nopo (mo**no**re**po**) is a Docker-based development environment with Django backend, React Router frontend, and infrastructure-as-code for GCP/Fly.io.

---

## Project Overview

```
nopo/
├── apps/                      # Services: backend (Django), web (React Router), db, nginx
├── packages/                  # Shared: configs, plop, ui (Storybook)
├── nopo/                      # CLI tool (scripts/, docker/, docs/)
├── infrastructure/            # GCP Terraform
├── fly/                       # Fly.io deployment
├── decisions/                 # ADRs
└── .github/                   # GitHub Actions
```

| Layer | Technologies |
|-------|--------------|
| Frontend | React 19, React Router 7, TypeScript, Vite, Tailwind |
| Backend | Django 5, DRF, Python 3.12+, Gunicorn |
| Database | PostgreSQL 16 |
| Build | pnpm 10.11+, uv (Python), Docker, Buildx Bake |
| Testing | Vitest, Playwright, Storybook |
| Linting | ESLint 9, Prettier, Ruff, mypy |
| Infra | Terraform, GCP, Fly.io, GitHub Actions |

---

## Getting Started

**Prerequisites:** Node.js 22.16+, pnpm 10.11+, Docker Compose v2.20+, Python 3.12+, uv

```bash
make                  # Install deps + show CLI help
make env              # Set up environment variables
make build            # Build Docker images
make up               # Start all services (http://localhost)
```

**Node Version:** Uses `.nvmrc` (22) for auto-switching. Run `nvm use` or configure shell for auto-switch with nvm/fnm.

---

## Git Worktrees

Worktrees enable parallel Claude sessions on different issues.

```bash
git worktree add ../nopo-issue-123 claude/issue/123   # Create
cd ../nopo-issue-123 && pnpm install                  # Setup
git worktree remove ../nopo-issue-123                 # Cleanup
git worktree list                                     # List all
```

**Naming:** Directory `../nopo-issue-{N}`, Branch `claude/issue/{N}`

**Before starting:** Check `gh pr list --search "is:open"` for conflicts. Rebase regularly: `git fetch origin && git rebase origin/main`

**Known issues:** Claude Code has worktree limitations ([#17374](https://github.com/anthropics/claude-code/issues/17374), [#16600](https://github.com/anthropics/claude-code/issues/16600), [#15776](https://github.com/anthropics/claude-code/issues/15776), [#2841](https://github.com/anthropics/claude-code/issues/2841)). Launch Claude from within the worktree directory.

---

## Command Reference

**Always prefer `make <command>` for nopo CLI operations.**

```bash
# Core
make build [service]      # Build Docker images
make up [service]         # Start services
make down                 # Stop services
make shell backend        # Shell into container
make status               # Check status

# Quality
make test                 # Run all tests
make check                # Lint + type check
make fix                  # Auto-fix issues

# Service-specific (backend)
make test backend         # Django tests
make migrate backend      # Run migrations
make makemigrations backend

# Direct tools
nopo compile ui           # Build specific package
uv run python manage.py test src
docker compose logs -f backend
```

---

## Development Workflow

### TDD Pattern

1. **Plan:** Create `plan-<feature>.md` with requirements, approach, tasks, tripwires, success criteria
2. **Write tests first** - should FAIL initially
3. **Verify failures** - fail because feature doesn't exist, not test errors
4. **Implement until tests pass**, then `make check && make test`

---

## Testing Philosophy

**Principles:** Test API not implementation • Minimize mocking • Integration first, unit second • E2E for critical flows

```
Integration (preferred) → API endpoints, DB interactions, minimal mocking
Unit (supplementary)    → Pure functions, utility code
E2E (critical paths)    → Page Object Model, data-testid selectors
```

**Backend:** Test HTTP response codes and JSON output, not internal method calls.
**Frontend:** Test component behavior via user events, not internal state.
**E2E selectors:** `data-testid` > `getByRole` > `getByText` > never CSS classes

```bash
make test                 # All tests
make test backend         # Django
nopo test ui              # Vitest
make smoketest            # Playwright
```

---

## Code Quality

**Always run before pushing:** `make check && make test`

```bash
make check                # All linting + type checks
make fix                  # Auto-fix
nopo check lint root      # ESLint
uv tool run ruff check    # Python
uv run mypy .             # Python types
```

**TypeScript:** strict mode, prefer `interface`, use `unknown` not `any`
**Python:** PEP 8, type hints everywhere, Django coding style

---

## Database & Migrations

### Expand-Contract Pattern

1. **Expand:** Add new field (nullable), keep old
2. **Transform:** Write to both old and new
3. **Switch:** Read from new (fallback to old)
4. **Contract:** Remove old field (separate PR!)

**Rules:**
- Migrations and code in **separate PRs**
- Migrations must be self-contained
- Test locally first: `make migrate backend`

---

## Pull Request Guidelines

- **Target:** < 500 lines, 1-2 commits
- **Format:** `<type>: <description>` (feat, fix, docs, refactor, test, chore)

**Before PR:**
```bash
make test && make check
git fetch origin && git rebase origin/main
```

**Merge:** `gh pr create --fill && gh pr merge --auto --squash`

---

## GitHub Actions Development

TypeScript actions in `.github/actions-ts/` provide type safety.

**Structure:** Each action has `action.yml`, `index.ts`, and committed `dist/` folder.

**Build/test:** `nopo compile actions root && nopo test actions root`

**Use TypeScript for:** Complex logic, multiple outputs, JSON manipulation, unit testing
**Use Composite for:** Simple delegation, environment setup, bash scripts

### Running Workflows Locally with Act

[Act](https://github.com/nektos/act) runs GitHub Actions locally using Docker.

**Prerequisites:** `brew install act` (requires Docker)

**Setup:**
```bash
cp .secrets.example .secrets    # Add your tokens
cp .vars.example .vars          # Add repo variables
```

**Commands:**
```bash
nopo act list                                  # List all workflows/jobs
nopo act dry -w ci.yml                         # Dry run (no execution)
nopo act run -w check-prompt-schemas.yml       # Run a workflow
nopo act run -w ci.yml -j test                 # Run specific job
nopo act dry -w _test_state_machine.yml -i scenario_name=triage
```

**Limitations:** Some workflows need GitHub API access (issues, PRs) and may fail locally. Use dry runs to validate workflow syntax without execution.

---

## Architecture & Documentation

| Type | Location |
|------|----------|
| ADRs | `decisions/` |
| CLI docs | `nopo/docs/` |
| Infrastructure | `infrastructure/ARCHITECTURE.md` |
| Service-specific | `apps/<service>/README.md` |

---

## Conventions

- **NPM packages:** `@more/<name>`
- **Scripts:** `<script>:workspace` (all), `<script>:root` (root), bare (both)
- **Environment:** `SERVICE_NAME`, `DOCKER_TAG`, `DOCKER_TARGET`, `NODE_ENV`
- **DRY:** Duplicate initially, abstract at 3+ instances

---

## Tripwires

**Signs you're going wrong:**
1. Excessive mocking → reconsider architecture
2. PR > 500 lines → break it up
3. Migrations + code in same PR → separate them
4. Manual CI steps → automate
5. Testing implementation details → test behavior
6. Modifying > 10 files for simple feature → refactor

**Ask for help:** Architectural decisions, CI/CD changes, production migrations, security

---

## Claude Automation State Machine

Automated issue management using GitHub Project fields for state. Race conditions prevented via draft/ready PR states.

### Actors

| Actor | Role |
|-------|------|
| **nopo-bot** | Trigger account - assign to issues/request as reviewer |
| **claude[bot]** | AI worker - implements, reviews, responds |
| **Human** | Supervisor - assigns, requests reviews, merges |

### Two-Level State Machine

**Parent issues** = big loop (overall progress). **Sub-issues** = little loop (per phase).

```
PARENT: Backlog → In Progress → Done (or Blocked/Error)
SUB:    Ready → Working → Review → Done
```

**Project Fields:** Status, Iteration (counter), Failures (consecutive)

**Parent statuses:** Backlog, In Progress, Done, Blocked, Error
**Sub-issue statuses:** Ready, Working, Review, Done

### State Transitions

```
Parent: Backlog --assign--> In Progress --all merged--> Done
                                |
                                v (max failures)
                            Blocked

Sub: Ready --iterate--> Working --CI pass--> Review --merge--> Done
                           ^                    |
                           +----(CI fail/changes requested)
```

### Trigger Flow

**Initialization:** Human assigns nopo-bot → creates sub-issues → Status=In Progress, first sub=Working

**Iteration:** `issues:edited` → find Working sub-issue → implement/fix → push → increment Iteration → CI runs

**CI Completion:** Updates Failures field, appends history → triggers next iteration

**Phase Complete:** PR merged → sub=Done → next sub=Working (or parent=Done if all merged)

**Breakpoints:**
- CI pass + todos done → sub=Review, request review
- All phases Done → parent=Done
- Max failures → parent=Blocked, unassign nopo-bot

**Circuit breaker:** `vars.MAX_CLAUDE_RETRIES` (default: 5). Re-assign nopo-bot to resume.

### Draft/Ready PR Control

Two loops, one gateway:
1. **Iteration Loop** (draft): push → CI → fail → fix → push
2. **Review Loop** (ready): review → response (no commits → re-request; has commits → draft → iteration)

CI is the bridge between loops.

### Triggers

| Action | Event | Condition |
|--------|-------|-----------|
| Triage | `issues:[opened,edited]` | No "triaged" label, not sub-issue |
| Iterate | `issues:[assigned,edited]` | nopo-bot assigned |
| @claude | `issue_comment` | Contains @claude |
| Review | `pull_request:[review_requested]` | nopo-bot reviewer, PR ready |

### Issue Commands

Comment these on issues to trigger the state machine:

| Command | Action |
|---------|--------|
| `/lfg` | Start/resume work on the issue (triggers iterate or orchestrate) |
| `/implement` | Same as `/lfg` - start implementing the issue |
| `/continue` | Same as `/lfg` - continue work on the issue |
| `/retry` | Clear failures and resume work (circuit breaker recovery) |

These commands work on both parent issues (triggers orchestration) and sub-issues (triggers iteration).

### Concurrency

- `claude-resource-issue-{N}`: Triage cancels, Iterate queues
- `claude-review-{branch}`: Push cancels reviews
- Queue mode for iterations (no edits missed)

### Agent Responsibilities

| Agent | Actions |
|-------|---------|
| Triage | Labels, project fields, sub-issues for phased work |
| Iterate | Implements/fixes, pushes, requests review on success |
| Orchestrate | Manages phases on parent issues |
| Review | Reviews code, submits batch review |
| Review Response | Addresses comments, converts draft if commits |

### Triage Details

**Labels:** Type (bug/enhancement/etc), Priority (low-critical), Topic (max 3)
**Fields:** Priority (P0-P2), Size (XS-XL), Estimate (Fibonacci hours)
**Sub-issues:** M/L/XL issues get 2-5 phases, title `[Phase N]: <Title>`

### PR Requirements

1. `Fixes #N` in body
2. CI passes
3. All todos addressed
4. Approved by Claude

### Setup

1. `CLAUDE_CODE_OAUTH_TOKEN` secret
2. `NOPO_BOT_PAT` secret (repo scope, for pushes)
3. `PROJECT_NUMBER` variable
4. GitHub Project with Status/Iteration/Failures fields

---

## Discussion Automation

Research/Q&A automation for GitHub Discussions. Simpler than issues (no CI).

### Flow

```
Create → Research (spawn threads) → Respond (investigate) → Update description
```

**Living Description:** Always reflects current knowledge - findings, answered questions, decisions, open questions.

### Triggers

| Event | Action |
|-------|--------|
| New discussion | Spawn 3-7 research threads |
| Human comment | Respond in thread |
| Bot research thread | Investigate and answer |
| Bot reply | Skip (prevent loop) |

### Commands

| Command | Action |
|---------|--------|
| `/summarize` | Comprehensive summary |
| `/plan` | Create issues from discussion |
| `/complete` | Mark complete, stop research |

### Limits

- Max 20 Claude comments per discussion
- Max 20 replies per thread
- Thread complete when: 20 comments, `/complete`, or Claude determines done

### Discussion vs Issues

**Discussions:** Research, architecture, "how does X work?", exploring approaches
**Issues:** Bugs, features, clear acceptance criteria, tracking implementation

**Workflow:** Discussion → `/plan` → Issues → Assign nopo-bot

---

## Quick Reference

```bash
# Daily
make up                    # Start services
make test && make check    # Validate

# Database
make migrate backend
make makemigrations backend

# Worktrees
git worktree add ../nopo-issue-123 claude/issue/123
git worktree remove ../nopo-issue-123
```
