# Template Base Image for Fetchr Environments
# This image contains the base system setup and will be inherited by all fetchr environments

FROM us-west1-docker.pkg.dev/proximal-core-0/environments/workspace-base-node:latest

# Set working directory
WORKDIR /root/workspace

# Environment is ready - workspace code will be added at runtime or in child images
CMD ["/startup.sh"]
