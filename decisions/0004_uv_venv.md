# Python Dependency Management in Docker with `uv`

Date: 2025-06-23

Status: accepted

## Context

Our Python-based microservices are deployed within Docker containers. We want to efficiently manage Python dependencies, aiming for:

1. Isolation of project dependencies without relying on traditional `venv`s on the host system, as Docker already provides isolation.
2. Pre-installation of all locked dependencies during the Docker build phase.
3. Ability to install packages from a local cache during runtime (offline mode) to ensure stability and speed, avoiding external network calls.
4. Avoiding conflicts or overwrites from mounted volumes during local development.

Initial attempts to install dependencies directly into the system Python environment within the Docker container using `uv sync --system` and then running the application directly with `python3` proved challenging due to `uv run`'s default behavior of creating a virtual environment, even when `UV_SYSTEM_PYTHON=true` was set. This led to errors where `uv` tried to create a non-existent virtual environment or download a new Python interpreter.

Specifically you can make UV run via a system python interpreter by setting

```bash
ENV UV_NO_MANAGED_PYTHON=true
ENV UV_SYSTEM_PYTHON=true
```

This prevents uv from downloading python binaries and tells it to install packages in the first python interpreter it finds in the path.
This still leaves a lot of ambiguity about which python interpreter to use, where the packages are installed and how to set the whole thing up.

Using uv directly means you can install python with `uv` declare the version of python and all dependencies in the pyproject.toml file
and even control where the packages are installed by controlling the path of the venv created and managed automatically by uv.

## Decision

We will standardize on using **`uv` to create and manage a dedicated virtual environment (`venv`) inside the Docker container within a multi-stage build process.** This approach offers a robust and clear separation of Python dependencies and runtime, leveraging `uv`'s strengths.

Specifically, the following steps will be implemented in our Dockerfiles:

1. **Base Image:** Start with a minimal base image (e.g., `debian:bookworm-slim` or `node:22.16.0-slim` as currently used, as long as it doesn't pre-install Python in a conflicting way).
2. **`uv` Installation:** Copy the `uv` binary directly from `ghcr.io/astral-sh/uv:latest` to ensure `uv` is available.
3. **Python Installation (Managed by `uv`):** In the **build stage**, `uv` will be used to install the required Python interpreter version (e.g., Python 3.12). This offloads Python version management from `apt` and ensures the exact interpreter version is used.
    * This will be achieved by setting `UV_HOME=/opt/uv_data` and using `uv python install <version> --preview`.
4. **Virtual Environment Creation and Dependency Installation:** In the **build stage**, `uv` will create a virtual environment at a dedicated, non-mountable path (e.g., `/opt/venv` by setting `ENV UV_PROJECT_ENVIRONMENT=/opt/venv`). All project dependencies specified in `uv.lock` will be installed into this `venv` using `uv sync --locked --no-dev`.
5. **Runtime Image Construction:** The **runtime stage** will use a very lean base image. It will then `COPY --from` the entire `/opt/venv` directory (containing the Python interpreter and all installed dependencies) from the build stage into the final image.
6. **Application Execution:** The application will be executed using `uv run` in the final image's `CMD`. Since `uv run` is designed to activate and run commands within `uv`-managed environments, this will seamlessly utilize the copied `venv` in offline mode (`uv run --offline --locked python manage.py runserver 0.0.0.0:80`). This explicitly uses the `venv` for isolation and leverages `uv`'s environment activation capabilities.

Environment variables like `UV_PYTHON="3.12"` and `UV_SYSTEM_PYTHON=true` will **not** be used, as they lead to ambiguous behavior when trying to force `uv run` to *not* use a virtual environment. `UV_NO_MANAGED_PYTHON=true` will also not be used, as we are explicitly choosing `uv` to manage the Python environment.

## Consequences

* **Positive:**
  * **Simplified Python Management:** No need to manage specific Python versions or backports via `apt`. `uv` handles it precisely.
  * **Clear Isolation:** Project dependencies are clearly isolated within `/opt/venv`, separate from any minimal system Python or other tools.
  * **Robust Offline Operation:** `uv run --offline` ensures that no network calls are made for dependencies at runtime, guaranteeing stable deployments.
  * **Reduced Runtime Image Size:** Only the necessary Python interpreter and project dependencies are copied to the final image, leading to leaner production containers.
  * **Consistent `uv run` Behavior:** `uv run` will behave as designed, activating and executing within its managed virtual environment, avoiding unexpected interpreter downloads or `.venv` issues.
    * **Avoids Mount Conflicts:** Placing the `venv` in `/opt/venv` prevents overwrites from mounted development volumes.

* **Negative:**
  * **Slightly Larger Initial `uv` Binary:** `uv` needs to be copied into the container, but it's a small, self-contained binary.
  * **Still Uses a `venv`:** While Docker provides OS-level isolation, this approach re-introduces a `venv` for Python-level isolation, which might seem redundant to some. However, the benefits of `uv`'s management and optimized multi-stage copying outweigh this perceived redundancy.
