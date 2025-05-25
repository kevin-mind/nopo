# Title

Date: 2025-05-25

Status: accepted

## Context

### pnpm script execution

Becuase this project uses a pnpm workspace monorepo, and given the superpowers of pnpm script execution,
it makes sense that the majority of scripts should be executed via package.json scripts.

This is sensible because it allows us to use filters to determine which packages to run scripts on,
define common scripts that can be run on multiple packages, and allow pnpm to determine dependencies
and ensure scripts are executed in the correct order.

Example:

```bash
pnpm run --filter '@more/web...' build --recursive
```

This is a very powerful script. It defines the target package as '@more/web' and also defines dependencies
of that package via the "..." wild card. This means we will run the "build" script on all of "@more/web" dependencies and then on "@more/web" itself. By adding recursive we ensure we trace any recursive dependencies and run the script on them as well.

### Sensible conventions

In the root package we can group scripts into categories:

- Workspace vs Root targeted scripts
- By command logic

This convention allows us to diferentiate if a script will run against the project root or via workspace packages.

```bash
pnpm run clean:root
```

This command will run the "clean" script on the root package, not in any workspace.

```bash
pnpm run clean:workspace
```

This command will run the "clean" script on any workspace package that defines it.

```bash
pnpm clean
```

This command will run both clean:workspace and clean:root scripts effectively executing the "clean" script
globally on both the root and any workspace packages that define it.

This convention is acheived by specifying the top level script like:

```json
"check": "pnpm run \"/^check:.*/\"",
```

That script will run any script in the root package.json that starts with the command name
(i.e. check:root, check:workspace, etc).

```json
"check:workspace": "pnpm run -r \"/^check:.*/\"",
"check:lint:root": "eslint",
"check:types:root": "tsc --noEmit",
```

We can define the workspace "check" command as well as any number of additional commands that will be run when `pnpm check` is executed.

### Universality

pnpm scripts are shell commands. This means we can define a package.json in any package/app and have full control over the script execution in that package. It does not need to be a node/javascript package. Could be a rust package, python package, etc. so long as commands can be executed via shell, it works.

## Decision

- All package lifecycle scripts are defined via package.json and executed via pnpm.
- Common/grouped scripts are defined in the root package.json and executed via conventional script names.
- A custom @more/scripts "run" command is provided to guide a user through script execution.

## Consequences

- all packages must define a package.json regardless of package type, language or framework.
- all scripts must be executable via shell.
- scripts should not rely on arguments for dynamic behavior but on environment variables where possible.
- dependencies between packages are defined in the package.json dependencies object.
- because scripts install dependencies on the host, and then again on the contaier, node_modules is frequently reinstalled. This is moderately annoying and should be fixed by:
  - removing node_modules mount from host -> container
  - enabling multi architecture images
  - entering a container before running pnpm run script <command>
