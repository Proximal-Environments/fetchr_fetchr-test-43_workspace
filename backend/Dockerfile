# Stage 1: Base setup and dependencies
FROM --platform=$TARGETPLATFORM public.ecr.aws/amazonlinux/amazonlinux:2023 AS base

ARG TARGETARCH
ARG TARGETPLATFORM

RUN mkdir -p /fetchr
WORKDIR /fetchr

# Install basic dependencies including Python build dependencies
RUN --mount=type=cache,target=/var/cache/dnf \
    dnf update -y && dnf install -y \
    tar gzip nodejs npm nginx \
    gcc make zlib-devel bzip2 bzip2-devel readline-devel sqlite sqlite-devel \
    openssl-devel tk-devel libffi-devel xz-devel git \
    ncurses-devel gdbm-devel

# Install pyenv and Python 3.11.9
ENV PYENV_ROOT="/root/.pyenv"
ENV PATH="${PYENV_ROOT}/bin:${PATH}"

RUN curl https://pyenv.run | bash && \
    echo 'eval "$(pyenv init -)"' >> ~/.bashrc && \
    exec $SHELL && \
    CONFIGURE_OPTS="--enable-shared" PYTHON_CONFIGURE_OPTS="--enable-shared" pyenv install 3.11.9 && \
    pyenv global 3.11.9

# Node & Nginx
RUN --mount=type=cache,target=/var/cache/dnf \
    dnf install -y nodejs npm nginx
RUN npm install -g pnpm@8.6
COPY release/nginx.conf /etc/nginx/nginx.conf

# # Rust - Not Needed RN
# ENV RUST_VERSION=1.73.0
# RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs -o rustup.sh && \
#     sh rustup.sh -y --default-toolchain ${RUST_VERSION} && \
#     rm rustup.sh && \
#     echo 'source $HOME/.cargo/env' >> /root/.bashrc && \
#     echo 'export PATH="$HOME/.cargo/bin:$PATH"' >> /root/.bashrc

# Install Development Tools
RUN --mount=type=cache,target=/var/cache/dnf \
    dnf groupinstall -y "Development Tools" && \
    dnf install -y gcc gcc-c++ make kernel-devel bison flex glibc-devel \
    autoconf automake libtool pkgconfig ncurses-devel \
    python3-devel cmake3 unzip git

# Additional dependencies for native modules
RUN --mount=type=cache,target=/var/cache/dnf \
    dnf install -y \
    python3 \
    python3-pip \
    python3-setuptools \
    python3-wheel

# NVM
RUN mkdir -p /root && touch /root/.bashrc
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
COPY .nvmrc .nvmrc
RUN . /root/.bashrc && nvm install $(cat /fetchr/.nvmrc) && nvm alias default $(cat /fetchr/.nvmrc)

# SSH
RUN --mount=type=cache,target=/var/cache/dnf \
    dnf install -y openssh-server
RUN ssh-keygen -A
RUN echo "PermitRootLogin yes" >> /etc/ssh/sshd_config
RUN echo 'root:eX1G5Sb18^`z' | chpasswd

# # Rust again in case .cargo was overwritten - Not needed rn
# RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
# ENV PATH="/root/.cargo/bin:${PATH}"
# RUN source $HOME/.cargo/env && \
#     rustc --version && \
#     cargo --version

# Add PNPM setup
ENV SHELL=/bin/bash
ENV PNPM_HOME="/root/.local/share/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"
RUN pnpm setup

# Stage 2: Application setup
FROM base AS app

# Configure shell to always source .bashrc
SHELL ["/bin/bash", "--login", "-c"]

# Use the same Node version from .nvmrc
RUN . /root/.bashrc && nvm use
ENV PATH="/root/.nvm/versions/node/$(cat .nvmrc)/bin:${PATH}"

# Additional environment variables for building other native modules
ENV npm_config_build_from_source=false
ENV npm_config_arch=x64
ENV npm_config_platform=linux

ENV npm_config_node_gyp=/usr/local/lib/node_modules/node-gyp/bin/node-gyp.js
RUN . /root/.bashrc && nvm use && npm install -g node-gyp

# Install required system libraries for ONNX Runtime
RUN --mount=type=cache,target=/var/cache/dnf \
    dnf install -y libgomp glibc libuuid

# Install grpcurl
RUN curl -sSL "https://github.com/fullstorydev/grpcurl/releases/download/v1.8.9/grpcurl_1.8.9_linux_x86_64.tar.gz" | tar -xz -C /usr/local/bin

# Install Playwright
RUN . /root/.bashrc && nvm use && \
    npm install -g playwright && \
    npx playwright install

# Install protobuf tooling
RUN --mount=type=cache,target=/var/cache/dnf \
    dnf install -y protobuf protobuf-compiler protobuf-devel

COPY python_server/requirements.txt python_server/

# Install dependencies
RUN --mount=type=cache,target=/root/.cache/pip \
    . /root/.bashrc && cd python_server && pip install --timeout=1000 -r requirements.txt

COPY server/package*.json server/pnpm-lock.yaml server/

RUN --mount=type=cache,target=/root/.npm \
    --mount=type=cache,target=/root/.pnpm-store \
    . /root/.bashrc && cd server && nvm use && pnpm install

COPY . .
RUN . /root/.bashrc && nvm use && cd server && pnpm run prisma:generate
RUN . /root/.bashrc && nvm use && cd server && pnpm run build

EXPOSE 80 443 8008 22 50053 9091

CMD ["sh", "-c", ". /root/.bashrc && /usr/sbin/sshd && cd server && nvm use && pnpm start"]