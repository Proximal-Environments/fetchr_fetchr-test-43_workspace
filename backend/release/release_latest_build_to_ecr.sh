#!/bin/bash

IMAGE_NAME="fetchr_backend"

# Get the ECR login command and execute it
aws ecr get-login-password --region us-west-2 --profile fetchr --no-cli-pager | docker login --username AWS --password-stdin $(aws sts get-caller-identity --query Account --output text --profile fetchr --no-cli-pager).dkr.ecr.us-west-2.amazonaws.com

# Tag latest for ECR
docker tag $IMAGE_NAME:latest $(aws sts get-caller-identity --query Account --output text --profile fetchr --no-cli-pager).dkr.ecr.us-west-2.amazonaws.com/$IMAGE_NAME:latest

# Push latest tag to ECR
docker push $(aws sts get-caller-identity --query Account --output text --profile fetchr --no-cli-pager).dkr.ecr.us-west-2.amazonaws.com/$IMAGE_NAME:latest

# Force update ECS service
aws ecs update-service --cluster fetchr-backend-cluster --service fetchr-backend-service --force-new-deployment --profile fetchr --region us-west-2 --no-cli-pager