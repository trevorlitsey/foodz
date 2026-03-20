# foodz

personal food & fitness journal. logs calories, macros, and exercise via plain-english input.

**live:** https://foodz.trevor.fail

## monorepo structure

```
foodz/
├── app/     — frontend (vanilla JS, deployed to S3/CloudFront)
├── api/     — lambda function source (Node.js, OpenAI for parsing)
└── infra/   — AWS SAM template + deploy scripts
```

## deploy

```bash
# deploy everything (lambda + frontend)
cd infra && ./deploy.sh

# lambda only (fast)
cd infra && ./deploy.sh --lambda-only

# frontend only
cd infra && ./deploy.sh --frontend-only
```

requires: `OPENAI_API_KEY` in `infra/.env` or env, AWS profile `fun-readwrite`

## architecture

```
foodz.trevor.fail  (S3 + CloudFront)
       ↓
api.foodz.trevor.fail  (API Gateway → Lambda)
       ↓
   DynamoDB  (foodz-days, foodz-events)
```
