# Use the GCP base image with password-only SSH authentication
FROM us-west1-docker.pkg.dev/proximal-core-0/environments/base:latest

# ========================================
# Layer 1: System dependencies (rarely changes)
# ========================================

# Install specific version of protobuf compiler (29.3) - CRITICAL for fetchr schemas
RUN wget https://github.com/protocolbuffers/protobuf/releases/download/v29.3/protoc-29.3-linux-x86_64.zip && \
    unzip protoc-29.3-linux-x86_64.zip -d protoc-29.3 && \
    mv protoc-29.3/bin/protoc /usr/local/bin/ && \
    mv protoc-29.3/include/* /usr/local/include/ && \
    rm -rf protoc-29.3 protoc-29.3-linux-x86_64.zip

# ========================================
# Layer 2: Python installation (rarely changes)
# ========================================

# Install specific Python version for fetchr with proper caching
# Pre-download Python source to enable Docker layer caching
RUN eval "$(pyenv init -)" && \
    mkdir -p ~/.pyenv/cache && \
    wget -q -O ~/.pyenv/cache/Python-3.11.9.tar.xz \
    https://www.python.org/ftp/python/3.11.9/Python-3.11.9.tar.xz

# Install Python from cached source (deterministic, faster subsequent builds)
RUN eval "$(pyenv init -)" && \
    export PYTHON_BUILD_CACHE_PATH=~/.pyenv/cache && \
    CONFIGURE_OPTS="--enable-shared" PYTHON_CONFIGURE_OPTS="--enable-shared" \
    pyenv install 3.11.9 && \
    pyenv global 3.11.9

# Set permanent environment variables for fetchr's Python version
ENV PYENV_ROOT="/root/.pyenv"
ENV PATH="${PYENV_ROOT}/versions/3.11.9/bin:${PYENV_ROOT}/bin:${PATH}"

# Install Python base tools
RUN eval "$(pyenv init -)" && pip install --upgrade pip setuptools wheel

# ========================================
# Layer 3: Node.js installation (rarely changes)
# ========================================

# Install Node.js version 20.12.0 (fetchr's required version)
# We hardcode the version instead of reading from .nvmrc since we don't have the file yet
RUN . "$NVM_DIR/nvm.sh" && \
    nvm install 20.12.0 && \
    nvm alias default 20.12.0 && \
    nvm use 20.12.0 && \
    echo 'nvm use 20.12.0' >> /root/.bashrc && \
    echo "✅ Node.js $(node --version) active" && \
    \
    npm install -g pnpm@8.6 && \
    echo "✅ pnpm installed"

# Set Node.js PATH permanently for all subsequent commands
ENV NVM_DIR="/root/.nvm"
ENV PATH="/root/.nvm/versions/node/v20.12.0/bin:${PATH}"

# ========================================
# Layer 4: Workspace structure (already cloned above)
# ========================================

# Create workspace directory structure
RUN mkdir -p /root/workspace/backend/server \
             /root/workspace/backend/python_server \
             /root/workspace/schema \
             /root/workspace/snapshots

# Go back to workspace root for task execution
WORKDIR /root/workspace

# Create a simple helper script for interactive development
RUN echo '#!/bin/bash' > /usr/local/bin/fetchr-dev && \
    echo 'cd /root/workspace' >> /usr/local/bin/fetchr-dev && \
    echo 'echo "🚀 Fetchr development environment ready!"' >> /usr/local/bin/fetchr-dev && \
    echo 'echo "   Node: $(node --version) | Python: $(python --version) | pnpm: $(pnpm --version)"' >> /usr/local/bin/fetchr-dev && \
    echo 'bash "$@"' >> /usr/local/bin/fetchr-dev && \
    chmod +x /usr/local/bin/fetchr-dev

# Expose essential ports (fetchr app ports only)
# Redis (6380) and PostgreSQL (5432) will be handled by infrastructure components
EXPOSE 22 3000 9091 8003 9901

# Clear the Git auth token for security (after all git operations are done)
ENV GIT_AUTH_TOKEN=

# CMD inherited from base image - starts SSH + MCP server