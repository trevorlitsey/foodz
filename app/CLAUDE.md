# CLAUDE.md — foodz-app

## what this is
a personal food & fitness journal web app. logs calories, macros, and exercise. built for trevor.

## live app
**url:** http://foodz-trevor-fail.s3-website-us-east-1.amazonaws.com/

## deployment

### s3 bucket
- **bucket:** `foodz-trevor-fail`
- **region:** us-east-1
- **aws profile:** `fun-readwrite` (in `~/.aws/credentials` on the pi)
- **static website hosting:** enabled (index.html as root and error doc)

### deploy command (from pi)
```bash
aws s3 sync ~/code/foodz-app/ s3://foodz-trevor-fail/ \
  --profile fun-readwrite \
  --exclude "data/*" \
  --exclude "*.json" \
  --exclude ".git/*" \
  --exclude "CLAUDE.md" \
  --content-type "text/html" \
  --include "index.html"

aws s3 cp ~/code/foodz-app/app.js s3://foodz-trevor-fail/app.js --profile fun-readwrite
aws s3 cp ~/code/foodz-app/style.css s3://foodz-trevor-fail/style.css --profile fun-readwrite
aws s3 cp ~/code/foodz-app/index.html s3://foodz-trevor-fail/index.html --profile fun-readwrite
```

or simpler, use the deploy script:
```bash
cd ~/code/foodz-app && ./deploy.sh
```

## food data (NOT in this repo)

### where data lives
- **local (pi):** `/home/trevorlitsey/.openclaw/workspace/food-journal/`
- **on s3:** `s3://foodz-trevor-fail/data/`
- **format:** `data/YYYY-MM-DD.json` + `data/index.json`

### how data gets to s3
when trevor logs food in the #foodz slack channel, the agent **automatically**:
1. writes/updates `/home/trevorlitsey/.openclaw/workspace/food-journal/YYYY-MM-DD.json`
2. regenerates `food-journal/index.json`
3. immediately pushes both to s3 with `--cache-control "no-cache"` to prevent stale data

helper script on the pi:
```bash
/home/trevorlitsey/.openclaw/workspace/food-journal/sync-to-s3.sh [YYYY-MM-DD]
```

**no manual sync needed** — the agent handles this on every log entry.

### data file format
```json
{
  "date": "2026-03-15",
  "goal_calories": 2200,
  "entries": [
    {
      "meal": "breakfast",
      "description": "oatmeal with peanut butter",
      "calories": 396,
      "protein": 11,
      "carbs": 53,
      "fat": 15,
      "timestamp": "2026-03-15T09:00:00"
    }
  ],
  "exercise": [
    {
      "description": "30 min run",
      "calories_burned": 320,
      "timestamp": "2026-03-15T07:00:00"
    }
  ],
  "totals": {
    "calories_in": 396,
    "calories_burned": 0,
    "net": 396,
    "protein": 11,
    "carbs": 53,
    "fat": 15
  }
}
```

### index.json format
```json
{
  "dates": ["2026-03-11", "2026-03-12", "2026-03-13", "2026-03-14"]
}
```

## app architecture
- **pure frontend** — no backend, fetches data from s3 directly
- `index.html` — shell + styles import
- `app.js` — all logic (fetching, rendering, nav)
- `style.css` — styles
- `data/index.json` — list of dates with logged data
- `data/YYYY-MM-DD.json` — per-day food log

## known issues / notes
- bucket name is "foodz-trevor-fail" (it's a feature, not a bug)
- data/ is excluded from repo and .gitignored — food data stays private
- today's date is always shown even if no data logged yet (shows empty state)
- `index.json` must be regenerated whenever a new day is logged; handled by the agent
