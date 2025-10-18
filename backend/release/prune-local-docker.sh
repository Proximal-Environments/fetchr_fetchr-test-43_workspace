# Stop all running containers
docker stop $(docker ps -aq) 2>/dev/null || true

# Remove all containers (both stopped and running)
docker rm $(docker ps -aq) 2>/dev/null || true

# Remove all images
docker rmi $(docker images -q) --force 2>/dev/null || true

# Remove all volumes
docker volume rm $(docker volume ls -q) 2>/dev/null || true

# Remove all networks except default ones
docker network prune -f 2>/dev/null || true

# Remove all stopped containers
docker rm $(docker ps -aq -f status=exited) 2>/dev/null || true

# Remove dangling images (unused and untagged)
docker rmi $(docker images -f "dangling=true" -q) --force 2>/dev/null || true

# Remove build cache
docker builder prune -f

# Perform a system prune but exclude running containers and their images
docker system prune -f --volumes

cd ../infra && ./init.sh
