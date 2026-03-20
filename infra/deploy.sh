#!/usr/bin/env bash
# deploy.sh — deploy foodz infrastructure + frontend
# Run from anywhere; paths are relative to this script's location.
# Usage:
#   ./deploy.sh                      # deploy lambda + frontend
#   ./deploy.sh --lambda-only        # redeploy Lambda code only (fast)
#   ./deploy.sh --frontend-only      # redeploy S3 frontend only
#   ./deploy.sh --setup              # first-time full SAM deploy

set -euo pipefail

PROFILE="fun-readwrite"
REGION="us-east-1"
LAMBDA_NAME="foodz-api"
FRONTEND_BUCKET="foodz-trevor-fail"
STACK_NAME="foodz"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
API_DIR="$REPO_ROOT/api"
APP_DIR="$REPO_ROOT/app"

# Load .env if present
if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a; source "$SCRIPT_DIR/.env"; set +a
fi

if [ -z "${OPENAI_API_KEY:-}" ]; then
  echo "❌ OPENAI_API_KEY is not set. Add it to infra/.env or export it." >&2
  exit 1
fi

MODE="${1:-all}"

# ── Lambda-only deploy ──
if [ "$MODE" = "--lambda-only" ]; then
  echo "📦 zipping lambda from api/index.mjs..."
  cp "$API_DIR/index.mjs" "$SCRIPT_DIR/lambda/index.mjs"
  cd "$SCRIPT_DIR/lambda"
  zip -r /tmp/foodz-lambda.zip index.mjs
  echo "🚀 updating lambda code..."
  aws --profile "$PROFILE" lambda update-function-code \
    --function-name "$LAMBDA_NAME" \
    --zip-file fileb:///tmp/foodz-lambda.zip \
    --query 'LastUpdateStatus' --output text
  echo "🔑 updating env vars..."
  aws --profile "$PROFILE" lambda update-function-configuration \
    --function-name "$LAMBDA_NAME" \
    --environment "Variables={OPENAI_API_KEY=$OPENAI_API_KEY}" \
    --query 'LastUpdateStatus' --output text
  echo "✓ lambda deployed"
  exit 0
fi

# ── Frontend-only deploy ──
if [ "$MODE" = "--frontend-only" ]; then
  echo "🌐 deploying frontend to s3://$FRONTEND_BUCKET..."
  aws --profile "$PROFILE" s3 cp "$APP_DIR/index.html" "s3://$FRONTEND_BUCKET/index.html" \
    --content-type "text/html" --cache-control "no-cache"
  aws --profile "$PROFILE" s3 cp "$APP_DIR/app.js" "s3://$FRONTEND_BUCKET/app.js" \
    --content-type "application/javascript" --cache-control "no-cache"
  aws --profile "$PROFILE" s3 cp "$APP_DIR/style.css" "s3://$FRONTEND_BUCKET/style.css" \
    --content-type "text/css" --cache-control "no-cache"
  echo "✓ frontend deployed → https://foodz.trevor.fail"
  exit 0
fi

# ── First-time setup ──
if [ "$MODE" = "--setup" ]; then
  echo "🔧 first-time SAM deploy..."
  cp "$API_DIR/index.mjs" "$SCRIPT_DIR/lambda/index.mjs"
  cd "$SCRIPT_DIR"
  sam build
  sam deploy \
    --stack-name "$STACK_NAME" \
    --profile "$PROFILE" \
    --region "$REGION" \
    --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
    --parameter-overrides "OpenAIApiKey=$OPENAI_API_KEY" \
    --no-confirm-changeset
  echo "✓ infrastructure deployed"
  "$0" --frontend-only
  exit 0
fi

# ── Default: redeploy lambda + frontend ──
echo "🚀 deploying lambda + frontend..."
"$0" --lambda-only
"$0" --frontend-only
echo "✓ all done"
