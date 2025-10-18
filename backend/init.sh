#!/usr/bin/env bash
# Version: 0.1.5
# Increment this version when the script is updated

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

# Get hostname from command line argument
logging_host_name="$1"

# Save hostname to server's .hostname file if provided
if [ -n "$logging_host_name" ]; then
    echo "$logging_host_name" > "$SCRIPT_DIR/server/.hostname"
    echo "Hostname set to: $logging_host_name"
fi

# copy over the server/.env.example to examples/.env
# cp -f "$SCRIPT_DIR"/server/.env.example "$SCRIPT_DIR"/server/.env

# Install nvm if not already installed.
if ! command -v nvm &> /dev/null; then
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.3/install.sh | bash
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
fi
if [[ "$OSTYPE" == "darwin"* ]]; then
  # Install specific version of protobuf (29.3)
  brew install protobuf@29
  brew install docker
  brew install docker-compose
elif command -v apt-get &> /dev/null; then
  sudo apt-get update
  # Install specific version of protobuf compiler (29.3)
  wget https://github.com/protocolbuffers/protobuf/releases/download/v29.3/protoc-29.3-linux-x86_64.zip
  unzip protoc-29.3-linux-x86_64.zip -d protoc-29.3
  sudo mv protoc-29.3/bin/protoc /usr/local/bin/
  sudo mv protoc-29.3/include/* /usr/local/include/
  rm -rf protoc-29.3 protoc-29.3-linux-x86_64.zip
  sudo apt-get install -y docker-compose
elif command -v yum &> /dev/null; then
  # Install specific version of protobuf compiler (29.3)
  wget https://github.com/protocolbuffers/protobuf/releases/download/v29.3/protoc-29.3-linux-x86_64.zip
  unzip protoc-29.3-linux-x86_64.zip -d protoc-29.3
  sudo mv protoc-29.3/bin/protoc /usr/local/bin/
  sudo mv protoc-29.3/include/* /usr/local/include/
  rm -rf protoc-29.3 protoc-29.3-linux-x86_64.zip
  sudo yum install -y docker-compose
fi

cd server
nvm install 20.12.0
nvm use

# Install pnpm using npm if not already installed
if ! command -v pnpm &> /dev/null; then
    npm install -g pnpm
fi

pnpm setup
pnpm add -g grpc-tools
npm install -g grpc-tools

pnpm install
pnpm install -g playwright
pnpm install playwright
npx playwright install
pnpm run proto
pnpm run prisma:pull
pnpm run prisma:generate
pnpm run build
cd ..

if [[ "$OSTYPE" == "darwin"* ]]; then
  brew install docker-compose
elif command -v apt-get &> /dev/null; then
  sudo apt-get update
  sudo apt-get install -y docker-compose
elif command -v yum &> /dev/null; then
  sudo yum install -y docker-compose
fi

cd python_server
pip install -r requirements.txt
cd ..

if [ -d "../infra" ]; then
  cd ../infra
  ./init.sh
fi