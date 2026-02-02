# Mimics GitHub Actions runner environment
FROM node:22-slim

# Install dependencies for Claude CLI
RUN apt-get update && apt-get install -y \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install Claude CLI globally (as done in GitHub Actions)
RUN npm install -g @anthropic-ai/claude-code

# Set up working directory
WORKDIR /app

# Copy package files first for layer caching
COPY package.json pnpm-lock.yaml ./

# Install pnpm and dependencies
RUN npm install -g pnpm && pnpm install --ignore-workspace

# Copy test files
COPY *.ts ./
COPY tsconfig.json ./

# Set environment variables similar to GitHub Actions
ENV CI=true
ENV FORCE_COLOR=1

# Default command
CMD ["npx", "tsx", "test-structured-v1.ts"]
