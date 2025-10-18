#!/bin/bash

IMAGE_NAME="fetchr_backend"
DEBUG_MODE=false  # Set to true to bypass all checks

# Interactive deployment target selection if not specified via command line
DEPLOY_TARGET=""
while [[ $# -gt 0 ]]; do
    case $1 in
        --local)
            DEPLOY_TARGET="local"
            shift
            ;;
        --ecs)
            DEPLOY_TARGET="ecs"
            shift
            ;;
        --debug)
            DEBUG_MODE=true
            shift
            ;;
        *)
            shift
            ;;
    esac
done

if [ -z "$DEPLOY_TARGET" ]; then
    echo "Select deployment target:"
    echo "1) ECS (Production Release)"
    echo "2) Local Development Build"
    read -p "Enter your choice (1 or 2): " choice
    case $choice in
        1)
            DEPLOY_TARGET="ecs"
            ;;
        2)
            DEPLOY_TARGET="local"
            ;;
        *)
            echo "Invalid choice. Exiting."
            exit 1
            ;;
    esac
fi

# Get the latest local version number
LATEST_VERSION=$(docker images $IMAGE_NAME --format "{{.Tag}}" | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -n 1)

# If no version exists, start with 1.0.0, otherwise increment the patch version
if [[ -z $LATEST_VERSION ]]; then
    NEW_VERSION="1.0.0"
else
    NEW_VERSION=$(echo $LATEST_VERSION | awk -F. '{$NF = $NF + 1;} 1' | sed 's/ /./g')
fi

if [ "$DEPLOY_TARGET" = "ecs" ] && [ "$DEBUG_MODE" = false ]; then
    # Check for pending changes in app repository
    # First, ensure we're on main branch
    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
    if [ "$CURRENT_BRANCH" != "main" ]; then
        echo "Error: Releases are only allowed from the main branch."
        echo "Current branch: $CURRENT_BRANCH"
        echo "To bypass this check, run with --debug flag."
        exit 1
    fi

    # Get the last release commit from release history
    RELEASE_HISTORY_FILE="release_history.jsonl"
    LAST_RELEASE=""
    if [ -f "$RELEASE_HISTORY_FILE" ]; then
        LAST_RELEASE=$(tail -n 1 "$RELEASE_HISTORY_FILE" | jq -r .commit_hash)
        echo -e "\n📦 Commits since last release:"
        if [ ! -z "$LAST_RELEASE" ]; then
            git log --pretty=format:"%h %s" $LAST_RELEASE..HEAD | cat
        else
            git log --pretty=format:"%h %s" HEAD~10..HEAD | cat
            echo -e "\n(Showing last 10 commits as no previous release found)"
        fi
    else
        echo -e "\n📦 Last 10 commits (no release history found):"
        git log --pretty=format:"%h %s" HEAD~10..HEAD | cat
    fi

    echo -e "\n"
    read -p "Do you want to proceed with the ECS release? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Release cancelled."
        exit 1
    fi

    cd server && pnpm run proto && pnpm run db:update && cd ..

    # Check for pending changes in backend repository
    # echo "Checking git status in backend repository..."
    # if [ -n "$(git status --porcelain)" ]; then
    #     echo "Error: There are uncommitted changes in the backend repository."
    #     echo "Please commit or stash your changes before running this script."
    #     echo "To bypass this check, run with --debug flag."
    #     exit 1
    # fi

    # Check if all changes are pushed to remote
    # echo "Checking for unpushed changes in backend repository..."
    # LOCAL_BRANCH=$(git rev-parse --abbrev-ref HEAD)
    # REMOTE_DIFF=$(git diff origin/$LOCAL_BRANCH..HEAD)
    # if [ -n "$REMOTE_DIFF" ]; then
    #     echo "Error: There are unpushed changes in the backend repository."
    #     echo "Please push your changes before running this script."
    #     echo "To bypass this check, run with --debug flag."
    #     exit 1
    # fi

    # # Check schema repository if it exists in parent directory
    # SCHEMA_DIR="../schema"
    # if [ -d "$SCHEMA_DIR" ]; then
    #     echo "Checking git status in schema repository..."
    #     CURRENT_DIR=$(pwd)
    #     cd $SCHEMA_DIR
        
    #     LOCAL_BRANCH=$(git rev-parse --abbrev-ref HEAD)
    #     REMOTE_DIFF=$(git diff origin/$LOCAL_BRANCH..HEAD)
    #     if [ -n "$REMOTE_DIFF" ]; then
    #         echo "Error: There are unpushed changes in the schema repository."
    #         echo "Please push your changes before running this script."
    #         echo "To bypass this check, run with --debug flag."
    #         cd "$CURRENT_DIR"
    #         exit 1
    #     fi
        
    #     # Check for breaking changes in schema
    #     echo "Checking for breaking changes in schema..."
    #     if ! buf breaking --against '.git#branch=main'; then
    #         echo "Error: Breaking non-compatible changes detected in schema."
    #         echo "Please fix breaking changes before running this script."
    #         echo "To bypass this check, run with --debug flag."
    #         cd "$CURRENT_DIR"
    #         exit 1
    #     fi
        
    #     cd "$CURRENT_DIR"
    # fi

    # Create cache directory
    mkdir -p ~/.cache/huggingface

    # Clean up old builder cache periodically (once per month)
    MONTH=$(date +%m)
    CACHE_MARKER=".prune_cache_$MONTH"
    if [ ! -f "$CACHE_MARKER" ]; then
        echo "Cleaning up old builder cache..."
        docker builder prune -f --filter until=72h
        touch "$CACHE_MARKER"
    fi
fi

if [ "$DEPLOY_TARGET" = "ecs" ]; then
    # Set up AWS ECR repository
    AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text --profile fetchr --no-cli-pager)
    AWS_REGION="us-west-2"
    ECR_REPO="$AWS_ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com/$IMAGE_NAME"

    # Check if the ECR repository exists, create it if it doesn't
    aws ecr describe-repositories --repository-names $IMAGE_NAME --region $AWS_REGION --profile fetchr --no-cli-pager > /dev/null 2>&1 || \
    aws ecr create-repository --repository-name $IMAGE_NAME --region $AWS_REGION --profile fetchr --no-cli-pager

    # Refresh AWS credentials right before build
    echo "Refreshing AWS credentials..."
    aws ecr get-login-password --region $AWS_REGION --profile fetchr --no-cli-pager | docker login --username AWS --password-stdin $ECR_REPO
    
    DOCKER_TAGS="-t $ECR_REPO:$NEW_VERSION -t $ECR_REPO:latest"
else
    echo "Building for local development..."
    DOCKER_TAGS="-t $IMAGE_NAME:dev -t $IMAGE_NAME:latest"
fi

# Set up buildx builder with better caching
echo "Setting up optimized Docker builder..."
BUILDER_NAME="fetchr-builder"
if ! docker buildx inspect $BUILDER_NAME >/dev/null 2>&1; then
    # First-time setup – create and bootstrap the builder
    docker buildx create --name $BUILDER_NAME --use --bootstrap
else
    # Re-use the existing builder so previous layers remain cached
    docker buildx use $BUILDER_NAME
fi

# Build and push
if [ "$DEPLOY_TARGET" = "ecs" ]; then
    if [ "$DEBUG_MODE" = true ]; then
        echo "⚠️ Building release version $NEW_VERSION in DEBUG MODE (checks bypassed)..."
    else
        echo "Building release version $NEW_VERSION..."
    fi
else
    echo "Building local development version..."
fi

if ! DOCKER_BUILDKIT=1 DOCKER_CLIENT_TIMEOUT=7200 COMPOSE_HTTP_TIMEOUT=7200 docker buildx build \
    --shm-size 24gb \
    --memory 8g \
    --memory-swap 16g \
    --platform linux/amd64 \
    --cache-from type=local,src=/tmp/docker-cache \
    --cache-to   type=local,dest=/tmp/docker-cache,mode=max \
    $([[ "$DEPLOY_TARGET" = "ecs" ]] && echo "--push" || echo "--load") \
    $DOCKER_TAGS \
    .; then
    echo "Docker build failed. Exiting."
    exit 1
fi

if [ "$DEPLOY_TARGET" = "ecs" ]; then
    # Set up lifecycle policy
    aws ecr put-lifecycle-policy \
        --repository-name $IMAGE_NAME \
        --lifecycle-policy-text '{"rules":[{"rulePriority":1,"description":"Keep last 5 images","selection":{"tagStatus":"any","countType":"imageCountMoreThan","countNumber":5},"action":{"type":"expire"}}]}' \
        --profile fetchr \
        --region $AWS_REGION \
        --no-cli-pager

    # Send Slack notification for successful release
    if [ $? -eq 0 ]; then
        # Get the current commit hash
        CURRENT_COMMIT=$(git rev-parse HEAD)
        
        # Get list of commits since last release
        COMMITS_LIST=""
        if [ -f "$RELEASE_HISTORY_FILE" ]; then
            LAST_RELEASE=$(tail -n 1 "$RELEASE_HISTORY_FILE" | jq -r .commit_hash)
            COMMITS_LIST=$(git log --pretty=format:"%h %s|https://github.com/fetchr-so/ts-backend/commit/%H" $LAST_RELEASE..$CURRENT_COMMIT)
        fi
        
        # Only update release history if not in debug mode
        if [ "$DEBUG_MODE" = false ]; then
            echo "{\"timestamp\": \"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\", \"commit_hash\": \"$CURRENT_COMMIT\", \"version\": \"$NEW_VERSION\", \"message\": \"Backend Deployment\"}" >> "$RELEASE_HISTORY_FILE"
        fi
        
        # Prepare commits message for Slack
        COMMITS_MESSAGE=""
        if [ ! -z "$COMMITS_LIST" ]; then
            COMMITS_MESSAGE="\n\n*Commits in this release:*"
            while IFS='|' read -r commit_info commit_url; do
                COMMITS_MESSAGE="$COMMITS_MESSAGE\n• <$commit_url|$commit_info>"
            done <<< "$COMMITS_LIST"
        fi
        
        DEBUG_NOTICE=""
        if [ "$DEBUG_MODE" = true ]; then
            DEBUG_NOTICE="\n\n⚠️ *This is a debug release with checks bypassed*"
        fi
        
        MESSAGE="🚀 New Backend Release Deployed!$DEBUG_NOTICE\n<https://$AWS_REGION.console.aws.amazon.com/ecs/v2/clusters/fetchr-backend-cluster/tasks?region=$AWS_REGION|Click here to review the deployment on ECS>$COMMITS_MESSAGE"
        
        curl -X POST -H 'Content-type: application/json' \
        --data "{
            \"channel\": \"C08HTA80EN8\",
            \"text\": \"$MESSAGE\",
            \"attachments\": [{
                \"color\": \"$([[ "$DEBUG_MODE" = true ]] && echo "warning" || echo "good")\",
                \"footer\": \"✅ New Backend Deployment v$NEW_VERSION completed successfully$([[ "$DEBUG_MODE" = true ]] && echo " (DEBUG MODE)")\"
            }]
        }" \
        "https://slack.com/api/chat.postMessage" \
        -H "Authorization: Bearer xoxb-5229797501522-8595065934770-gk0kWosbv2MmCFLNPftRvVTY"

        # Force update ECS service
        aws ecs update-service --cluster fetchr-backend-cluster --service fetchr-backend-service --force-new-deployment --profile fetchr --region $AWS_REGION --no-cli-pager
    fi
else
    echo "✅ Local development build completed successfully!"
    echo "You can now use the following commands to run the container:"
    echo "docker run -d $IMAGE_NAME:latest"
    echo "or"
    echo "docker run -d $IMAGE_NAME:dev"
fi