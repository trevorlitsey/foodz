# foodz-infra

AWS infrastructure for the foodz food & fitness journal.

## Architecture

```
foodz.trevor.fail (S3 static site)
        ↓
api.foodz.trevor.fail (API Gateway → Lambda)
        ↓
    DynamoDB (foodz-days, foodz-events)
```

- **Frontend:** S3 static website (`foodz-trevor-fail` bucket)
- **API:** Lambda function (`foodz-api`) behind HTTP API Gateway
- **Database:** DynamoDB (pay-per-request)
- **Parsing:** OpenAI `gpt-4o-mini` for plain-English food/exercise input

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Health check |
| GET | /dates | List all logged dates |
| GET | /day/:date | Get a day's data |
| PUT | /day/:date | Replace a day's data (bot sync) |
| POST | /day/:date/entries | Add a single entry |
| DELETE | /day/:date/entries/:idx | Remove an entry |
| GET | /day/:date/history | Audit log for a day |
| **POST** | **/log** | **Parse plain English → save entries** |

### POST /log

Accepts plain English and parses it into structured food/exercise entries.

```json
{
  "text": "breakfast: 2 eggs, toast with butter, coffee",
  "date": "2026-03-17"  // optional, defaults to today (America/Chicago)
}
```

Returns:
```json
{
  "ok": true,
  "date": "2026-03-17",
  "entries": [...],
  "exercise": [...],
  "totals": { "calories_in": 254, "calories_burned": 0, "net": 254, ... },
  "goal_calories": 2200
}
```

## Setup

### Prerequisites
- [AWS CLI](https://aws.amazon.com/cli/) configured with `fun-readwrite` profile
- [AWS SAM CLI](https://aws.amazon.com/serverless/sam/) (for first-time deploy only)
- OpenAI API key

### First-time deploy

```bash
cp .env.example .env
# edit .env with your OPENAI_API_KEY

./deploy.sh --setup
```

### Redeploy (after code changes)

```bash
./deploy.sh              # lambda + frontend
./deploy.sh --lambda-only
./deploy.sh --frontend-only
```

## Local development

The Lambda code is pure Node.js with no dependencies (uses built-in `https` and AWS SDK v3 which is pre-installed in Lambda). You can test locally with [AWS SAM local](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-cli-command-reference-sam-local-invoke.html):

```bash
sam local invoke FoodzApiFunction --event events/log-test.json
```

## Related repos

- **Frontend:** [trevorlitsey/foodz](https://github.com/trevorlitsey/foodz)
- **Infra:** this repo
