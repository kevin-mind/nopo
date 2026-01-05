---
description: Analyze the codebase and update documentation
allowed-tools: Bash, Read, Grep, Glob, Edit, Write
---

# Documentation Update Task

Analyze the codebase and update documentation to ensure it accurately reflects the current state of the project.

## Instructions

1. **Explore the codebase structure** to understand the current state:

   - Review the `apps/` directory for application services
   - Review the `packages/` directory for shared packages
   - Review the `infrastructure/` directory for deployment configs
   - Review the `nopo/` directory for CLI documentation

2. **Check existing documentation** for accuracy:

   - `CLAUDE.md` - AI agent guidelines
   - `README.md` - Project overview
   - `decisions/*.md` - Architecture Decision Records
   - `infrastructure/ARCHITECTURE.md` - GCP infrastructure docs
   - `nopo/docs/` - CLI documentation
   - `apps/*/README.md` - Service-specific docs

3. **Identify documentation gaps**:

   - New features or services without documentation
   - Outdated command references
   - Missing API documentation
   - Stale architecture diagrams

4. **Update documentation** as needed:

   - Update command examples if CLI has changed
   - Add documentation for new services/features
   - Remove references to deprecated functionality
   - Ensure code examples still work

5. **Create new ADRs** if significant architectural changes were made:
   - Copy `decisions/template.md` to create new ADRs
   - Follow the Context/Decision/Consequences format

## Output

Provide a summary of:

- Documentation files reviewed
- Changes made to existing documentation
- New documentation files created
- Any remaining documentation gaps that need attention

$ARGUMENTS
