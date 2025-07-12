# Python Dependency Management in Docker with `uv`

Date: 2025-06-23

Status: accepted

## Context

Our Python-based microservices are deployed within Docker containers. We want to efficiently manage Python dependencies, aiming for:

1. Seamless switching between running commands on the host machine and in Docker containers
2. Shared virtual environment that works both on host and in container
3. Virtual environment that "repairs" itself on every run to ensure consistency
4. Pre-installation of all locked dependencies during development and build phases
5. Visibility of installed packages in the editor for debugging and development

Initial attempts used a container-only approach with `/opt/venv`, but this prevented seamless switching between host and container environments and made debugging more difficult.

## Decision

We will standardize on using **`uv` to create and manage a shared virtual environment (`.venv`) in the repository root** that can be used both on the host machine and in Docker containers.

Specifically, the following approach will be implemented:

1. **Virtual Environment Location:** UV will create a `.venv` directory in the repository root using `UV_PROJECT_ENVIRONMENT=/app/.venv`
2. **Host Machine Setup:** UV will be installed on the host machine and manage the `.venv` directory directly
3. **Container Volume Mounting:** The `.venv` directory will be mounted from the host to the container at `/app/.venv`
4. **Self-Healing Environment:** Both host and container environments will check and repair the `.venv` on every run
5. **Unified Scripts:** A `uv-run.sh` script provides consistent UV management across environments
6. **Makefile Integration:** Common UV commands are integrated into the Makefile for easy access

### Implementation Details

#### Docker Configuration:
- `UV_PROJECT_ENVIRONMENT="/app/.venv"` - Forces UV to use the repository root .venv
- `UV_PYTHON_PREFERENCE=only-managed` - Ensures consistent Python version management
- Volume mount: `- ../.venv:/app/.venv:cached` - Shares .venv between host and container

#### Host Machine:
- UV installed via official installer: `curl -LsSf https://astral.sh/uv/install.sh | sh`
- `uv-run.sh` script handles UV environment setup and command execution
- Makefile targets for common operations: `make uv-check`, `make uv-sync`, `make py <command>`

#### Self-Healing Mechanism:
- Both host and container check `.venv` validity on startup
- Automatic `uv sync --frozen` when environment is missing or corrupted
- Python version consistency checks against `.python-version` file

## Consequences

* **Positive:**
  * **Seamless Environment Switching:** Developers can run Python commands on host or in container transparently
  * **Editor Integration:** All packages are visible in the editor for debugging and development
  * **Consistent Dependencies:** Shared lock file ensures identical environments everywhere
  * **Self-Healing:** Environment automatically repairs itself preventing common development issues
  * **Unified Tooling:** Single script and Makefile targets work across all environments
  * **Fast Development:** No need to rebuild containers when changing Python dependencies

* **Negative:**
  * **Host Dependencies:** Requires UV to be installed on the host machine
  * **Platform Considerations:** .venv may need platform-specific packages (though UV handles this well)
  * **Volume Mounting:** Requires proper volume mounting setup in docker-compose

* **Migration:**
  * **From Previous Setup:** Remove any existing `/opt/venv` references in Dockerfiles
  * **New Projects:** Run `./uv-run.sh` to initialize the environment
  * **Existing Projects:** Run `make uv-sync` to migrate to the new setup
