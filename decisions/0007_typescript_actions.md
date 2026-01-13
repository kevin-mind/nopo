# TypeScript Actions

Date: 2026-01-13

Status: accepted

## Context

Our GitHub Actions workflows are written in YAML, which has several limitations:

1. **No type safety**: YAML provides no compile-time validation, making it easy to introduce errors that are only caught at runtime in CI.
2. **Limited IDE support**: Auto-completion and documentation are inconsistent across editors.
3. **Poor reusability**: Sharing logic between workflows requires copy-paste or complex composite actions.
4. **Difficult testing**: YAML workflows cannot be unit tested locally.
5. **Verbosity**: Common patterns require repetitive boilerplate.

The `github-actions-workflow-ts` library allows writing workflows in TypeScript, providing type safety, better IDE support, and the ability to share code between workflows.

## Decision

We will use `github-actions-workflow-ts` to write GitHub Actions workflows in TypeScript instead of YAML. The key decisions are:

1. **Package installation**: Add the following to root devDependencies:
   - `@github-actions-workflow-ts/lib` - Core library for workflow definitions
   - `@github-actions-workflow-ts/cli` - CLI tool to generate YAML from TypeScript
   - `@github-actions-workflow-ts/actions` - Typed wrappers for common actions

2. **Directory structure**:
   - Source: `.github/workflows-ts/` - TypeScript workflow files (`*.wac.ts`)
   - Output: `.github/workflows/` - Generated YAML files (existing location)

3. **Build command**: Add `gwf build` to package.json scripts for generating YAML.

4. **CI validation**: Integrate generation check into `make check` to ensure TypeScript source matches generated YAML.

5. **Migration strategy** (phased approach):
   - **Phase 1 (this ADR)**: Setup tooling, migrate `_test_nopo.yml` as proof of concept
   - **Phase 2**: Migrate remaining workflows incrementally
   - **Phase 3**: Extract common patterns into shared modules

6. **File naming convention**: TypeScript files use `.wac.ts` extension (e.g., `_test_nopo.wac.ts`), generating corresponding YAML files (e.g., `_test_nopo.yml`).

7. **Rollback plan**: If issues arise, we can revert to editing YAML directly since the generated files are committed. The TypeScript source can be removed without affecting CI.

## Consequences

### Benefits

- **Type safety**: TypeScript compiler catches errors before CI runs
- **IDE support**: Full auto-completion and inline documentation
- **Code sharing**: Common patterns (e.g., checkout + setup steps) can be extracted into functions
- **Testability**: Workflow logic can be unit tested
- **Maintainability**: DRY principles can be applied across workflows

### Trade-offs

- **Additional dependency**: Three new npm packages in devDependencies
- **Build step**: YAML generation must run before committing workflow changes
- **Learning curve**: Contributors must understand the TypeScript API
- **Generated files**: Both source (.wac.ts) and generated (.yml) files are in the repo

### Mitigations

- CI validation ensures generated YAML stays in sync with TypeScript source
- Generated YAML files include a header indicating they are auto-generated
- Documentation will be added to AGENTS.md once migration progresses
