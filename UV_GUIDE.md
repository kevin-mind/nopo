# UV Python Environment Guide

This guide explains how to work with the UV-managed Python environment that works seamlessly between your host machine and Docker containers.

## Quick Start

1. **First Time Setup**:
   ```bash
   # Install UV if not already installed
   curl -LsSf https://astral.sh/uv/install.sh | sh
   source $HOME/.local/bin/env
   
   # Initialize the virtual environment
   ./uv-run.sh
   ```

2. **Running Python Commands**:
   ```bash
   # Using the UV wrapper script
   ./uv-run.sh run python --version
   ./uv-run.sh run python manage.py runserver
   
   # Using Make shortcuts
   make py ARGS="--version"
   make py ARGS="manage.py runserver"
   ```

## How It Works

The setup creates a `.venv` directory in the repository root that is shared between your host machine and Docker containers. This means:

- ✅ You can run Python commands on your host machine
- ✅ You can run the same commands in Docker containers
- ✅ Your editor can see all installed packages for debugging
- ✅ The environment automatically repairs itself if corrupted

## Available Commands

### UV Script Commands

```bash
# Check if virtual environment is ready
./uv-run.sh

# Sync dependencies (repair environment)
./uv-run.sh sync --frozen

# Run Python commands
./uv-run.sh run python <command>
./uv-run.sh run python manage.py <django_command>

# Run any command in the virtual environment
./uv-run.sh run <command>
```

### Makefile Shortcuts

```bash
# Check environment status
make uv-check

# Sync dependencies
make uv-sync

# Run Python commands
make py ARGS="--version"
make py ARGS="manage.py runserver"
make py ARGS="manage.py migrate"

# Run any UV command
make uv-run ARGS="<command>"

# Open a shell in the virtual environment
make uv-shell
```

### Docker Commands

```bash
# The same commands work in Docker containers
docker compose run --rm backend bash
# Inside container:
./uv-run.sh run python manage.py runserver
```

## Development Workflow

### Adding New Dependencies

1. **Add to pyproject.toml**:
   ```toml
   [project]
   dependencies = [
       "django>=5.2.3",
       "your-new-package>=1.0.0",
   ]
   ```

2. **Update lock file**:
   ```bash
   ./uv-run.sh lock
   ```

3. **Sync environment**:
   ```bash
   ./uv-run.sh sync --frozen
   ```

### Common Django Commands

```bash
# Database migrations
make py ARGS="manage.py makemigrations"
make py ARGS="manage.py migrate"

# Run development server
make py ARGS="manage.py runserver"

# Django shell
make py ARGS="manage.py shell"

# Create superuser
make py ARGS="manage.py createsuperuser"

# Collect static files
make py ARGS="manage.py collectstatic"
```

### Debugging

Since the virtual environment is in the repository root, your editor can access all packages:

1. **VS Code**: Point your Python interpreter to `.venv/bin/python`
2. **PyCharm**: Set project interpreter to `.venv/bin/python`
3. **Other editors**: Use `.venv/bin/python` as the Python path

## Environment Repair

The environment automatically repairs itself when:
- The `.venv` directory is missing
- The `pyvenv.cfg` file is corrupted
- The Python version doesn't match `.python-version`

To manually repair:
```bash
# Remove corrupted environment
rm -rf .venv

# Recreate environment
./uv-run.sh
```

## Container Integration

The Docker setup automatically:
- Mounts `.venv` from host to container
- Checks environment health on startup
- Repairs environment if needed

### Volume Mounting

The `.venv` directory is mounted in `docker-compose.base.yml`:
```yaml
volumes:
  - ..:/app:cached
  - ../.venv:/app/.venv:cached
```

### Environment Variables

Key UV environment variables in the container:
- `UV_PROJECT_ENVIRONMENT="/app/.venv"` - Use repository root .venv
- `UV_PYTHON_PREFERENCE=only-managed` - Consistent Python management
- `UV_COMPILE_BYTECODE=1` - Optimize Python bytecode

## Troubleshooting

### UV Command Not Found

```bash
# Install UV
curl -LsSf https://astral.sh/uv/install.sh | sh

# Add to PATH
source $HOME/.local/bin/env

# Or add to your shell profile
echo 'source $HOME/.local/bin/env' >> ~/.bashrc
```

### Permission Issues

```bash
# Fix ownership of .venv
sudo chown -R $(id -u):$(id -g) .venv

# Or recreate the environment
rm -rf .venv
./uv-run.sh
```

### Package Not Found

```bash
# Check if package is in pyproject.toml
grep "your-package" pyproject.toml

# Sync dependencies
./uv-run.sh sync --frozen

# Check installed packages
./uv-run.sh run pip list
```

### Environment Corruption

```bash
# Force recreation
rm -rf .venv
./uv-run.sh

# Check Python version
./uv-run.sh run python --version
```

## Best Practices

1. **Always use the wrapper script** for Python commands
2. **Keep UV and lock files in sync** by running `uv-run.sh sync --frozen` after dependency changes
3. **Use Make shortcuts** for common commands
4. **Let the environment repair itself** - don't manually edit .venv contents
5. **Keep .python-version updated** when upgrading Python versions

## Integration with IDEs

### VS Code

1. Open Command Palette (Ctrl+Shift+P)
2. Search "Python: Select Interpreter"
3. Choose `.venv/bin/python`

### PyCharm

1. Go to File → Settings → Project → Python Interpreter
2. Click gear icon → Add
3. Choose "Existing environment"
4. Select `.venv/bin/python`

### Vim/Neovim

Add to your Python LSP configuration:
```vim
let g:python3_host_prog = '.venv/bin/python'
```