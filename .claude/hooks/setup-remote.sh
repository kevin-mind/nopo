#!/bin/bash

# Only run in remote (cloud) environments
if [ "$CLAUDE_CODE_REMOTE" != "true" ]; then
  exit 0
fi

# Install gh CLI via apt (more reliable than downloading from GitHub releases)
if ! command -v gh &> /dev/null; then
  sudo apt-get update && sudo apt-get install -y gh
fi

exit 0
