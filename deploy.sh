#!/bin/bash
# deploys app files to s3 (NOT data — data synced separately by the agent)
set -e

BUCKET="foodz-trevor-fail"
PROFILE="fun-readwrite"

echo "deploying to s3://$BUCKET ..."
aws s3 cp index.html s3://$BUCKET/index.html --profile $PROFILE --content-type "text/html"
aws s3 cp app.js s3://$BUCKET/app.js --profile $PROFILE --content-type "application/javascript"
aws s3 cp style.css s3://$BUCKET/style.css --profile $PROFILE --content-type "text/css"
echo "done → http://$BUCKET.s3-website-us-east-1.amazonaws.com/"
