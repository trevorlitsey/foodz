# CLAUDE.md — foodz monorepo

## what is this
personal food & fitness journal. logs calories/macros/exercise via plain-english input.
live at **https://foodz.trevor.fail** | api at **https://api.foodz.trevor.fail**

---

## repo structure

```
foodz/
├── app/        vanilla JS frontend, deployed to S3 + CloudFront
├── api/        Lambda function (Node.js ESM), handles all API logic
└── infra/      AWS SAM template + deploy scripts
```

---

## app/

pure frontend — no build step, no framework.

- `index.html` — shell
- `app.js` — all logic (fetch, render, nav, log modal, queue)
- `style.css` — styles
- `deploy.sh` — pushes to S3 (use `infra/deploy.sh --frontend-only` instead)

**local dev:**
```bash
cd app && npm run dev   # serves on localhost:3000
```

**key patterns:**
- `submitLog()` — POSTs plain text to `POST /log`, shows result in queue toast
- `renderDay(dateStr)` — fetches day data and renders meals + exercise + summary
- `weekDataCache` — in-memory cache for week chart, invalidated after writes
- queue toast shows items + cal per item + net/remaining after each log

---

## api/

lambda function source. single file: `api/index.mjs`.

**runtime:** Node.js 22, ESM (`"type": "module"`)
**deps:** `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb` (AWS-managed in Lambda)
**AI:** Anthropic Claude (haiku for parsing, haiku/sonnet for chat based on complexity)

**env vars required:**
- `ANTHROPIC_API_KEY` — for food parsing + chat
- `OPENAI_API_KEY` — currently unused, kept for fallback

**DynamoDB tables:**
- `foodz-days` — per-day food/exercise data, keyed by `date` (YYYY-MM-DD)
- `foodz-events` — audit log of all mutations
- `foodz-ratelimit` — rate limiting (10 `/log` calls/IP/hour)
- `foodz-profiles` — per-user preferences/notes

**endpoints:**

| method | path | description |
|--------|------|-------------|
| GET | /health | health check |
| GET | /dates | list all logged dates |
| GET | /day/:date | get full day data |
| PUT | /day/:date | replace full day (bot sync) |
| POST | /day/:date/entries | add an entry |
| PATCH | /day/:date/entries/:idx | patch an entry |
| DELETE | /day/:date/entries/:idx | remove an entry |
| DELETE | /day/:date/entries/:idx/items/:itemIdx | remove a single item |
| PATCH | /day/:date/exercise/:idx | patch exercise entry |
| DELETE | /day/:date/exercise/:idx | remove exercise entry |
| GET | /day/:date/history | audit log for a day |
| POST | /log | **parse plain english → save** |
| POST | /chat | conversational interface |
| GET | /profile | get user profile/memory |
| PUT | /profile | update user profile/memory |

**POST /log** — main endpoint. accepts `{ text, date }`, parses with Claude haiku, applies
entries or edits to the day, returns `{ ok, date, entries, exercise, edits, totals, goal_calories, day }`.

key invariant: **meal-level totals are always recomputed from items** — never trust stored
meal totals, always sum from `entry.items[]`. enforced on every write path.

**local dev:**
```bash
cd api && npm run dev   # runs server.js on port 3030
```

---

## infra/

SAM template + unified deploy script.

**deploy:**
```bash
cd infra

# redeploy everything (copies api/index.mjs → lambda/, zips, uploads + pushes frontend)
./deploy.sh

# lambda only (fast, ~10s)
./deploy.sh --lambda-only

# frontend only
./deploy.sh --frontend-only

# first-time setup
./deploy.sh --setup
```

**important:** `infra/deploy.sh --lambda-only` copies `api/index.mjs` to `infra/lambda/` before
zipping. `infra/lambda/` is gitignored. always edit `api/index.mjs`, never the lambda copy.

**aws profile:** `fun-readwrite` (in `~/.aws/credentials`)
**region:** `us-east-1`
**lambda name:** `foodz-api`
**frontend bucket:** `foodz-trevor-fail`

requires `infra/.env` with:
```
OPENAI_API_KEY=sk-...
```

---

## data model

```json
{
  "date": "2026-03-19",
  "goal_calories": 2200,
  "exercise": [
    { "activity": "run", "calories_burned": 320, "duration_minutes": 30 }
  ],
  "entries": [
    {
      "meal": "breakfast",
      "description": "oatmeal with peanut butter",
      "calories": 453,
      "protein": 15,
      "carbs": 61,
      "fat": 18,
      "items": [
        { "name": "oatmeal (2/3 cup)", "calories": 227, "protein": 8, "carbs": 41, "fat": 4 }
      ]
    }
  ],
  "totals": {
    "calories_in": 453,
    "calories_burned": 0,
    "net": 453,
    "protein": 15,
    "carbs": 61,
    "fat": 18
  }
}
```

`goal_calories = 2200 + calories_burned`
meal `calories/protein/carbs/fat` = sum of `items[]` (always — never set independently)

---

## common tasks

**deploy after api change:**
```bash
cd infra && ./deploy.sh --lambda-only
```

**deploy after frontend change:**
```bash
cd infra && ./deploy.sh --frontend-only
```

**check lambda status:**
```bash
aws --profile fun-readwrite lambda get-function --function-name foodz-api \
  --query 'Configuration.LastUpdateStatus' --output text
```

**tail lambda logs:**
```bash
aws --profile fun-readwrite logs tail /aws/lambda/foodz-api --follow
```

**test the api:**
```bash
curl -s https://api.foodz.trevor.fail/day/2026-03-19 | python3 -m json.tool
curl -s -X POST https://api.foodz.trevor.fail/log \
  -H "Content-Type: application/json" \
  -d '{"text":"2 eggs and toast","date":"2026-03-19"}'
```
