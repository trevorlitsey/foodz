import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const https = require("https");

const client = new DynamoDBClient({ region: "us-east-1" });
const ddb = DynamoDBDocumentClient.from(client);

const DAYS_TABLE = "foodz-days";
const EVENTS_TABLE = "foodz-events";
const RATELIMIT_TABLE = "foodz-ratelimit";
const PROFILES_TABLE = "foodz-profiles";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const CLAUDE_HAIKU  = "claude-haiku-4-5";
const CLAUDE_SONNET = "claude-sonnet-4-5";

// Rate limit: max 10 /log calls per IP per hour
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_SEC = 3600;

function ts() {
  return new Date().toISOString();
}

function response(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      ...headers,
    },
    body: JSON.stringify(body),
  };
}

async function putEvent(date, action, by, extra = {}) {
  const now = ts();
  await ddb.send(
    new PutCommand({
      TableName: EVENTS_TABLE,
      Item: { date, ts: now, action, by, ...extra },
    })
  );
}

function computeTotals(entries, exercise) {
  const totals = { calories_in: 0, calories_burned: 0, net: 0, protein: 0, carbs: 0, fat: 0 };
  for (const e of entries) {
    totals.calories_in += e.calories || 0;
    totals.protein += e.protein || 0;
    totals.carbs += e.carbs || 0;
    totals.fat += e.fat || 0;
  }
  for (const ex of exercise) {
    totals.calories_burned += ex.calories_burned || 0;
  }
  totals.net = totals.calories_in - totals.calories_burned;
  return totals;
}

// ── OpenAI parser ──

const TREVOR_DEFAULTS = `Trevor's known defaults — use these exact values when he references them by name:
- "normal oatmeal" / "regular oatmeal" / "my oatmeal":
    meal: breakfast, items: [3/4 cup oatmeal (170 cal, 6p, 31c, 3f), 1 tbsp maple syrup (52 cal, 0p, 13c, 0f), 0.5 tbsp chia seeds (30 cal, 1p, 2c, 2f), 1.5 tbsp peanut butter (142 cal, 6p, 5c, 12f)], total: 394 cal, 13p, 51c, 17f
- "regular coffee" / "normal coffee" / "my coffee" / "morning coffee":
    items: [coffee with milk + maple syrup (76 cal, 1p, 14c, 1f)], total: 76 cal, 1p, 14c, 1f
- "Olipop" / "Ollipop": 35 cal, 0p, 9c, 0f
- "baby carrots (1/2 cup)": 25 cal, 1p, 6c, 0f
- "baby carrots (1 cup)": 52 cal, 1p, 12c, 0f
- "Poppi soda": 25 cal, 0p, 6c, 0f
- "Simple Mills wheat crackers (1 serving)": 150 cal, 3p, 19c, 7f`;

const PARSE_SYSTEM_PROMPT = `You are a food and fitness journal parser for Trevor (175lbs male, 2200 cal/day base goal).
Parse plain English input describing food eaten, exercise done, OR edits/corrections to existing entries.

${TREVOR_DEFAULTS}

Return ONLY valid JSON with this exact structure (no markdown, no extra text):
{
  "entries": [
    {
      "meal": "breakfast|lunch|dinner|snack|afternoon snack|evening snack|pre-gym snack|post-gym",
      "description": "brief natural description of the meal",
      "items": [
        { "name": "item name with quantity", "calories": 0, "protein": 0, "carbs": 0, "fat": 0 }
      ],
      "calories": 0,
      "protein": 0,
      "carbs": 0,
      "fat": 0
    }
  ],
  "exercise": [
    {
      "activity": "activity name",
      "duration_minutes": 0,
      "calories_burned": 0,
      "notes": ""
    }
  ]
}

Rules:
- Use accurate nutritional estimates from standard food databases (USDA etc)
- All numbers are integers (round to nearest whole number)
- meal-level calories/protein/carbs/fat must equal the sum of all items
- calories_burned for exercise: use MET × weight (175lbs = 79.4kg) × duration_hours formula
- If no meal type specified, infer from context (morning=breakfast, noon=lunch, evening=dinner, default=snack)
- entries and exercise can be empty arrays if that type isn't in the input
- For restaurant items, estimate the whole dish; break into reasonable sub-items
- description should be concise and natural

EDITS: If the input is correcting/updating an existing entry (e.g. "update crossfit to 200 cals", "change breakfast calories to 450", "actually the quesadilla was 350 cal"), return an "edits" array instead of adding new entries:
{
  "entries": [],
  "exercise": [],
  "edits": [
    {
      "type": "exercise",
      "match": "crossfit",
      "patch": { "calories_burned": 200 }
    }
  ]
}
- "type" is "entry" or "exercise"
- "match" is a fuzzy string to find in activity/meal name
- "patch" contains only the fields to change (calories_burned, calories, protein, carbs, fat, duration_minutes, notes, description)
- For meal entry calorie edits, also update the matching item's calories if items exist
- entries/exercise must be empty arrays when edits are present`;

// ── Rate limiter (IP-based, 10 req/hr for /log) ──

async function checkRateLimit(ip) {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - RATE_LIMIT_WINDOW_SEC;
  const key = `log:${ip}`;

  try {
    const result = await ddb.send(
      new UpdateCommand({
        TableName: RATELIMIT_TABLE,
        Key: { key },
        UpdateExpression:
          "SET #count = if_not_exists(#count, :zero) + :one, #window = if_not_exists(#window, :now), #ttl = :ttl",
        ConditionExpression: "attribute_not_exists(#window) OR #window >= :windowStart",
        ExpressionAttributeNames: {
          "#count": "count",
          "#window": "windowStart",
          "#ttl": "ttl",
        },
        ExpressionAttributeValues: {
          ":zero": 0,
          ":one": 1,
          ":now": now,
          ":windowStart": windowStart,
          ":ttl": now + RATE_LIMIT_WINDOW_SEC * 2,
        },
        ReturnValues: "ALL_NEW",
      })
    );
    const count = result.Attributes?.count || 1;
    return { allowed: count <= RATE_LIMIT_MAX, count, limit: RATE_LIMIT_MAX };
  } catch (err) {
    if (err.name === "ConditionalCheckFailedException") {
      // Window expired — reset
      await ddb.send(
        new PutCommand({
          TableName: RATELIMIT_TABLE,
          Item: { key, count: 1, windowStart: now, ttl: now + RATE_LIMIT_WINDOW_SEC * 2 },
        })
      );
      return { allowed: true, count: 1, limit: RATE_LIMIT_MAX };
    }
    // On error, fail open (don't block the user)
    console.error("Rate limit check error:", err);
    return { allowed: true, count: 0, limit: RATE_LIMIT_MAX };
  }
}

// ── Claude API caller ──

function callClaude(messages, systemPrompt, model = CLAUDE_HAIKU, maxTokens = 1024) {
  return new Promise((resolve, reject) => {
    if (!ANTHROPIC_API_KEY) {
      reject(new Error("ANTHROPIC_API_KEY not configured"));
      return;
    }

    const body = JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
    });

    const options = {
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(parsed.error.message || JSON.stringify(parsed.error)));
            return;
          }
          const text = parsed.content?.[0]?.text || "";
          resolve(text);
        } catch (e) {
          reject(new Error("Failed to parse Claude response: " + e.message));
        }
      });
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// Parse food log text → structured JSON using Claude
async function parseLog(text, existingDay = null, recentDays = []) {
  let contextBlocks = [];

  // Current day context
  if (existingDay && (existingDay.entries?.length || existingDay.exercise?.length)) {
    const ctx = [];
    if (existingDay.entries?.length) {
      const entryLines = existingDay.entries.map((e, i) => {
        let line = `[${i}] ${e.meal}: ${e.description} (${e.calories} cal | ${e.protein}g P ${e.carbs}g C ${e.fat}g F)`;
        if (e.items && e.items.length > 0) {
          line += "\n    items: " + e.items.map(it => `${it.name} ${it.calories}cal ${it.protein}gP ${it.carbs}gC ${it.fat}gF`).join(" | ");
        }
        return line;
      });
      ctx.push("Today's entries so far:\n" + entryLines.join("\n"));
    }
    if (existingDay.exercise?.length)
      ctx.push("Today's exercise: " + existingDay.exercise.map((e, i) => `[${i}] ${e.activity} (${e.calories_burned} cal burned)`).join("; "));
    contextBlocks.push(ctx.join("\n\n"));
  }

  // Recent days context (last 7)
  if (recentDays.length > 0) {
    const recent = recentDays.slice(0, 7).map(d => {
      const t = d.totals || {};
      const meals = (d.entries || []).map(e => e.description || e.meal).join(", ");
      return `${d.date}: ${t.calories_in || 0} cal in | ${t.protein || 0}g P | ${t.carbs || 0}g C | ${t.fat || 0}g F — ${meals}`;
    }).join("\n");
    contextBlocks.push("Recent 7 days (for pattern recognition):\n" + recent);
  }

  const systemWithContext = contextBlocks.length > 0
    ? PARSE_SYSTEM_PROMPT + "\n\nContext:\n" + contextBlocks.join("\n\n")
    : PARSE_SYSTEM_PROMPT;

  const raw = await callClaude(
    [{ role: "user", content: text }],
    systemWithContext + "\n\nRespond with ONLY the JSON object, no other text.",
    CLAUDE_HAIKU,
    1024
  );

  // Strip markdown fences if present
  const cleaned = raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
  return JSON.parse(cleaned);
}

// Determine if a chat message needs sonnet (complex) or haiku (simple)
function routeModel(messages) {
  const lastMsg = (messages[messages.length - 1]?.content || "").toLowerCase();
  const complexPatterns = [
    /\b(compare|trend|average|week|history|why|explain|analyse|analyze|pattern|progress|over time|past|last \d)\b/,
    /\?.*\?/,  // multiple questions
  ];
  const isComplex = complexPatterns.some(p => p.test(lastMsg)) || lastMsg.length > 200 || messages.length > 4;
  return isComplex ? CLAUDE_SONNET : CLAUDE_HAIKU;
}

// Pull last N days of data from DynamoDB
async function getRecentDays(n = 7, beforeDate = null) {
  try {
    const result = await ddb.send(new ScanCommand({
      TableName: DAYS_TABLE,
      FilterExpression: beforeDate ? "#d < :before" : undefined,
      ExpressionAttributeNames: beforeDate ? { "#d": "date" } : undefined,
      ExpressionAttributeValues: beforeDate ? { ":before": beforeDate } : undefined,
    }));
    return (result.Items || [])
      .map(item => typeof item.data === "string" ? JSON.parse(item.data) : item.data)
      .filter(d => d && d.date)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, n);
  } catch {
    return [];
  }
}

export const handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod || "GET";
  const rawPath = event.rawPath || event.path || "/";
  const stagePrefix = event.requestContext?.stage ? `/${event.requestContext.stage}` : "";
  const path =
    stagePrefix && rawPath.startsWith(stagePrefix)
      ? rawPath.slice(stagePrefix.length) || "/"
      : rawPath;

  // Handle CORS preflight
  if (method === "OPTIONS") {
    return response(200, {});
  }

  try {
    // GET /health
    if (method === "GET" && path === "/health") {
      return response(200, { status: "ok", ts: ts() });
    }

    // GET /dates
    if (method === "GET" && path === "/dates") {
      const result = await ddb.send(
        new ScanCommand({
          TableName: DAYS_TABLE,
          ProjectionExpression: "#d",
          ExpressionAttributeNames: { "#d": "date" },
        })
      );
      const dates = (result.Items || []).map((i) => i.date).sort();
      return response(200, { dates });
    }

    // GET /day/:date
    const dayMatch = path.match(/^\/day\/(\d{4}-\d{2}-\d{2})$/);
    if (method === "GET" && dayMatch) {
      const date = dayMatch[1];
      const result = await ddb.send(
        new GetCommand({ TableName: DAYS_TABLE, Key: { date } })
      );
      if (!result.Item) return response(404, { error: "not found" });
      const data =
        typeof result.Item.data === "string"
          ? JSON.parse(result.Item.data)
          : result.Item.data;
      return response(200, data);
    }

    // GET /day/:date/history
    const historyMatch = path.match(/^\/day\/(\d{4}-\d{2}-\d{2})\/history$/);
    if (method === "GET" && historyMatch) {
      const date = historyMatch[1];
      const result = await ddb.send(
        new QueryCommand({
          TableName: EVENTS_TABLE,
          KeyConditionExpression: "#d = :date",
          ExpressionAttributeNames: { "#d": "date" },
          ExpressionAttributeValues: { ":date": date },
          ScanIndexForward: true,
        })
      );
      return response(200, { events: result.Items || [] });
    }

    // PUT /day/:date
    const putDayMatch = path.match(/^\/day\/(\d{4}-\d{2}-\d{2})$/);
    if (method === "PUT" && putDayMatch) {
      const date = putDayMatch[1];
      const body =
        typeof event.body === "string" ? JSON.parse(event.body) : event.body;
      const by = body._by || "bot";
      const note = body._note;
      const data = { ...body };
      delete data._by;
      delete data._note;

      await ddb.send(
        new PutCommand({
          TableName: DAYS_TABLE,
          Item: { date, data, updatedAt: ts() },
        })
      );
      await putEvent(date, "set_day", by, { note: note || "replaced full day" });
      return response(200, { ok: true, date });
    }

    // POST /day/:date/entries
    const postEntriesMatch = path.match(/^\/day\/(\d{4}-\d{2}-\d{2})\/entries$/);
    if (method === "POST" && postEntriesMatch) {
      const date = postEntriesMatch[1];
      const body =
        typeof event.body === "string" ? JSON.parse(event.body) : event.body;
      const by = body._by || "bot";
      const entry = { ...body };
      delete entry._by;

      const existing = await ddb.send(
        new GetCommand({ TableName: DAYS_TABLE, Key: { date } })
      );
      const dayData = existing.Item?.data || {
        date,
        goal_calories: 2200,
        entries: [],
        exercise: [],
        totals: { calories_in: 0, calories_burned: 0, net: 0, protein: 0, carbs: 0, fat: 0 },
      };

      dayData.entries = [...(dayData.entries || []), entry];
      dayData.totals = computeTotals(dayData.entries, dayData.exercise || []);

      await ddb.send(
        new PutCommand({
          TableName: DAYS_TABLE,
          Item: { date, data: dayData, updatedAt: ts() },
        })
      );
      await putEvent(date, "add_entry", by, { entry });
      return response(201, { ok: true, date, entries: dayData.entries.length });
    }

    // PATCH /day/:date/exercise/:idx
    const patchExerciseMatch = path.match(/^\/day\/(\d{4}-\d{2}-\d{2})\/exercise\/(\d+)$/);
    if (method === "PATCH" && patchExerciseMatch) {
      const date = patchExerciseMatch[1];
      const idx = parseInt(patchExerciseMatch[2], 10);
      const body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;

      const existing = await ddb.send(new GetCommand({ TableName: DAYS_TABLE, Key: { date } }));
      if (!existing.Item) return response(404, { error: "day not found" });

      const dayData = existing.Item.data;
      const exercise = dayData.exercise || [];
      if (idx < 0 || idx >= exercise.length) return response(400, { error: "invalid index" });

      dayData.exercise[idx] = { ...exercise[idx], ...body };
      dayData.totals = computeTotals(dayData.entries || [], dayData.exercise);
      dayData.goal_calories = 2200 + dayData.totals.calories_burned;

      await ddb.send(new PutCommand({ TableName: DAYS_TABLE, Item: { date, data: dayData, updatedAt: ts() } }));
      await putEvent(date, "patch_exercise", "trevor", { idx, patch: body });
      return response(200, { ok: true, date, exercise: dayData.exercise[idx], totals: dayData.totals, goal_calories: dayData.goal_calories });
    }

    // PATCH /day/:date/entries/:idx
    const patchEntryMatch = path.match(/^\/day\/(\d{4}-\d{2}-\d{2})\/entries\/(\d+)$/);
    if (method === "PATCH" && patchEntryMatch) {
      const date = patchEntryMatch[1];
      const idx = parseInt(patchEntryMatch[2], 10);
      const body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;

      const existing = await ddb.send(new GetCommand({ TableName: DAYS_TABLE, Key: { date } }));
      if (!existing.Item) return response(404, { error: "day not found" });

      const dayData = existing.Item.data;
      const entries = dayData.entries || [];
      if (idx < 0 || idx >= entries.length) return response(400, { error: "invalid index" });

      dayData.entries[idx] = { ...entries[idx], ...body };
      // Always recompute entry totals from items when items exist — items are source of truth
      const patchedItems = dayData.entries[idx].items;
      if (patchedItems && patchedItems.length > 0) {
        dayData.entries[idx].calories = patchedItems.reduce((s, i) => s + (i.calories || 0), 0);
        dayData.entries[idx].protein  = patchedItems.reduce((s, i) => s + (i.protein  || 0), 0);
        dayData.entries[idx].carbs    = patchedItems.reduce((s, i) => s + (i.carbs    || 0), 0);
        dayData.entries[idx].fat      = patchedItems.reduce((s, i) => s + (i.fat      || 0), 0);
      }
      dayData.totals = computeTotals(dayData.entries, dayData.exercise || []);

      await ddb.send(new PutCommand({ TableName: DAYS_TABLE, Item: { date, data: dayData, updatedAt: ts() } }));
      await putEvent(date, "patch_entry", "trevor", { idx, patch: body });
      return response(200, { ok: true, date, entry: dayData.entries[idx], totals: dayData.totals });
    }

    // DELETE /day/:date/entries/:idx
    const deleteEntryMatch = path.match(/^\/day\/(\d{4}-\d{2}-\d{2})\/entries\/(\d+)$/);
    if (method === "DELETE" && deleteEntryMatch) {
      const date = deleteEntryMatch[1];
      const idx = parseInt(deleteEntryMatch[2], 10);

      const existing = await ddb.send(
        new GetCommand({ TableName: DAYS_TABLE, Key: { date } })
      );
      if (!existing.Item) return response(404, { error: "day not found" });

      const dayData = existing.Item.data;
      const entries = dayData.entries || [];
      if (idx < 0 || idx >= entries.length)
        return response(400, { error: "invalid index" });

      const removed = entries[idx];
      dayData.entries = entries.filter((_, i) => i !== idx);
      dayData.totals = computeTotals(dayData.entries, dayData.exercise || []);

      await ddb.send(
        new PutCommand({
          TableName: DAYS_TABLE,
          Item: { date, data: dayData, updatedAt: ts() },
        })
      );
      await putEvent(date, "delete_entry", "trevor", { entry: removed });
      return response(200, { ok: true, date, removed });
    }

    // DELETE /day/:date/entries/:entryIdx/items/:itemIdx
    const deleteItemMatch = path.match(/^\/day\/(\d{4}-\d{2}-\d{2})\/entries\/(\d+)\/items\/(\d+)$/);
    if (method === "DELETE" && deleteItemMatch) {
      const date = deleteItemMatch[1];
      const entryIdx = parseInt(deleteItemMatch[2], 10);
      const itemIdx = parseInt(deleteItemMatch[3], 10);

      const existing = await ddb.send(
        new GetCommand({ TableName: DAYS_TABLE, Key: { date } })
      );
      if (!existing.Item) return response(404, { error: "day not found" });

      const dayData = existing.Item.data;
      const entries = dayData.entries || [];
      if (entryIdx < 0 || entryIdx >= entries.length)
        return response(400, { error: "invalid entry index" });

      const entry = entries[entryIdx];
      const items = entry.items || [];
      if (itemIdx < 0 || itemIdx >= items.length)
        return response(400, { error: "invalid item index" });

      const removed = items[itemIdx];
      entry.items = items.filter((_, i) => i !== itemIdx);

      // recompute entry totals from remaining items
      if (entry.items.length > 0) {
        entry.calories = entry.items.reduce((s, i) => s + (i.calories || 0), 0);
        entry.protein  = entry.items.reduce((s, i) => s + (i.protein  || 0), 0);
        entry.carbs    = entry.items.reduce((s, i) => s + (i.carbs    || 0), 0);
        entry.fat      = entry.items.reduce((s, i) => s + (i.fat      || 0), 0);
      }

      dayData.entries = entries;
      dayData.totals = computeTotals(dayData.entries, dayData.exercise || []);

      await ddb.send(
        new PutCommand({
          TableName: DAYS_TABLE,
          Item: { date, data: dayData, updatedAt: ts() },
        })
      );
      await putEvent(date, "delete_item", "trevor", { entryIdx, item: removed });
      return response(200, { ok: true, date, removed });
    }

    // ── DELETE /day/:date/exercise/:idx ──
    const deleteExerciseMatch = path.match(/^\/day\/(\d{4}-\d{2}-\d{2})\/exercise\/(\d+)$/);
    if (method === "DELETE" && deleteExerciseMatch) {
      const date = deleteExerciseMatch[1];
      const idx = parseInt(deleteExerciseMatch[2], 10);

      const existing = await ddb.send(
        new GetCommand({ TableName: DAYS_TABLE, Key: { date } })
      );
      if (!existing.Item) return response(404, { error: "day not found" });

      const dayData = existing.Item.data;
      const exercise = dayData.exercise || [];
      if (idx < 0 || idx >= exercise.length)
        return response(400, { error: "invalid index" });

      const removed = exercise[idx];
      dayData.exercise = exercise.filter((_, i) => i !== idx);
      dayData.totals = computeTotals(dayData.entries || [], dayData.exercise);
      dayData.goal_calories = 2200 + dayData.totals.calories_burned;

      await ddb.send(
        new PutCommand({
          TableName: DAYS_TABLE,
          Item: { date, data: dayData, updatedAt: ts() },
        })
      );
      await putEvent(date, "delete_exercise", "trevor", { exercise: removed });
      return response(200, { ok: true, date, removed, totals: dayData.totals, goal_calories: dayData.goal_calories });
    }

    // ── POST /log — plain-English food/exercise parser ──
    if (method === "POST" && path === "/log") {
      // Rate limit by IP
      const ip =
        event.requestContext?.http?.sourceIp ||
        event.requestContext?.identity?.sourceIp ||
        "unknown";
      const rl = await checkRateLimit(ip);
      if (!rl.allowed) {
        return response(429, {
          error: `rate limit exceeded — max ${rl.limit} log requests per hour`,
        });
      }

      const body =
        typeof event.body === "string" ? JSON.parse(event.body) : event.body;
      const text = (body?.text || "").trim();

      if (!text) return response(400, { error: "text is required" });

      // Use current date (Chicago time) if not provided
      const date = body?.date || (() => {
        return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
      })();

      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return response(400, { error: "invalid date format, use YYYY-MM-DD" });
      }

      // Load or create the day first (needed for edit context)
      const existing = await ddb.send(
        new GetCommand({ TableName: DAYS_TABLE, Key: { date } })
      );
      let dayData = existing.Item?.data
        ? (typeof existing.Item.data === "string" ? JSON.parse(existing.Item.data) : existing.Item.data)
        : {
            date,
            goal_calories: 2200,
            entries: [],
            exercise: [],
            totals: { calories_in: 0, calories_burned: 0, net: 0, protein: 0, carbs: 0, fat: 0 },
          };

      // Pull recent days for context, then parse
      const recentDays = await getRecentDays(7, date);
      const parsed = await parseLog(text, dayData, recentDays);
      const entries = parsed.entries || [];
      const exercise = parsed.exercise || [];
      const edits = parsed.edits || [];

      if (entries.length === 0 && exercise.length === 0 && edits.length === 0) {
        return response(400, { error: "could not parse any food or exercise from that input" });
      }

      // Apply edits to existing entries
      let editSummary = [];
      const MACRO_FIELDS = ["calories", "protein", "carbs", "fat", "calories_burned", "duration_minutes"];
      for (const edit of edits) {
        const matchStr = (edit.match || "").toLowerCase();
        if (edit.type === "exercise") {
          const idx = (dayData.exercise || []).findIndex(e =>
            e.activity.toLowerCase().includes(matchStr) || matchStr.includes(e.activity.toLowerCase())
          );
          if (idx >= 0) {
            const before = { ...dayData.exercise[idx] };
            dayData.exercise[idx] = { ...before, ...edit.patch };
            const diffs = MACRO_FIELDS.filter(f => edit.patch[f] !== undefined && edit.patch[f] !== before[f])
              .map(f => `${f}: ${before[f] ?? "?"} → ${edit.patch[f]}`);
            editSummary.push(`${dayData.exercise[idx].activity}${diffs.length ? ` (${diffs.join(", ")})` : ""}`);
          }
        } else if (edit.type === "entry") {
          const idx = (dayData.entries || []).findIndex(e =>
            e.meal.toLowerCase().includes(matchStr) ||
            matchStr.includes(e.meal.toLowerCase()) ||
            (e.description || "").toLowerCase().includes(matchStr)
          );
          if (idx >= 0) {
            const existing = dayData.entries[idx];
            const patch = { ...edit.patch };
            const itemDiffs = [];
            // Merge items by name instead of replacing the whole array
            if (patch.items && existing.items && existing.items.length > 0) {
              const mergedItems = [...existing.items];
              for (const patchItem of patch.items) {
                const patchName = (patchItem.name || "").toLowerCase();
                const itemIdx = mergedItems.findIndex(i =>
                  i.name.toLowerCase().includes(patchName) || patchName.includes(i.name.toLowerCase())
                );
                if (itemIdx >= 0) {
                  const beforeItem = mergedItems[itemIdx];
                  mergedItems[itemIdx] = { ...beforeItem, ...patchItem };
                  const d = MACRO_FIELDS.filter(f => patchItem[f] !== undefined && patchItem[f] !== beforeItem[f])
                    .map(f => `${f}: ${beforeItem[f] ?? "?"} → ${patchItem[f]}`);
                  if (d.length) itemDiffs.push(`${beforeItem.name}: ${d.join(", ")}`);
                } else {
                  mergedItems.push(patchItem); // new item — append
                  itemDiffs.push(`added ${patchItem.name}`);
                }
              }
              patch.items = mergedItems;
              // Recompute entry totals from merged items
              patch.calories = mergedItems.reduce((s, i) => s + (i.calories || 0), 0);
              patch.protein  = mergedItems.reduce((s, i) => s + (i.protein  || 0), 0);
              patch.carbs    = mergedItems.reduce((s, i) => s + (i.carbs    || 0), 0);
              patch.fat      = mergedItems.reduce((s, i) => s + (i.fat      || 0), 0);
            }
            const entryDiffs = MACRO_FIELDS.filter(f => patch[f] !== undefined && patch[f] !== existing[f])
              .map(f => `${f}: ${existing[f] ?? "?"} → ${patch[f]}`);
            dayData.entries[idx] = { ...existing, ...patch };
            // Always recompute entry totals from items when items exist — items are source of truth
            const finalItems = dayData.entries[idx].items;
            if (finalItems && finalItems.length > 0) {
              dayData.entries[idx].calories = finalItems.reduce((s, i) => s + (i.calories || 0), 0);
              dayData.entries[idx].protein  = finalItems.reduce((s, i) => s + (i.protein  || 0), 0);
              dayData.entries[idx].carbs    = finalItems.reduce((s, i) => s + (i.carbs    || 0), 0);
              dayData.entries[idx].fat      = finalItems.reduce((s, i) => s + (i.fat      || 0), 0);
            }
            const allDiffs = [...itemDiffs, ...entryDiffs.filter(d => !itemDiffs.some(id => id.includes(d.split(":")[0])))];
            editSummary.push(`${dayData.entries[idx].meal}${allDiffs.length ? ` (${allDiffs.join("; ")})` : ""}`);
          }
        }
      }

      // Append new entries & exercise
      dayData.entries  = [...(dayData.entries  || []), ...entries];
      dayData.exercise = [...(dayData.exercise || []), ...exercise];

      // Recalculate totals and goal
      dayData.totals = computeTotals(dayData.entries, dayData.exercise);
      const burned = dayData.totals.calories_burned || 0;
      dayData.goal_calories = 2200 + burned;

      // Save to DynamoDB
      await ddb.send(
        new PutCommand({
          TableName: DAYS_TABLE,
          Item: { date, data: dayData, updatedAt: ts() },
        })
      );

      // Log event
      const action = edits.length > 0 ? "web_edit" : "web_log";
      await putEvent(date, action, "web", { text, entries, exercise, edits });

      return response(200, {
        ok: true,
        date,
        entries,
        exercise,
        edits: editSummary,
        totals: dayData.totals,
        goal_calories: dayData.goal_calories,
        day: dayData,
      });
    }

    // ── GET /profile — user preferences/memory doc ──
    if (method === "GET" && path === "/profile") {
      const userId = (event.queryStringParameters?.userId || "trevor");
      const result = await ddb.send(new GetCommand({ TableName: PROFILES_TABLE, Key: { userId } })).catch(() => null);
      if (!result?.Item) {
        return response(200, { userId, defaults: {}, notes: "", updatedAt: null });
      }
      return response(200, result.Item);
    }

    // ── PUT /profile — update user preferences ──
    if (method === "PUT" && path === "/profile") {
      const body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
      const userId = body.userId || "trevor";
      const item = { userId, ...body, updatedAt: ts() };
      await ddb.send(new PutCommand({ TableName: PROFILES_TABLE, Item: item }));
      return response(200, { ok: true, userId });
    }

    // ── POST /chat — multi-turn conversational assistant ──
    if (method === "POST" && path === "/chat") {
      const ip = event.requestContext?.http?.sourceIp || "unknown";
      const rl = await checkRateLimit(ip);
      if (!rl.allowed) return response(429, { error: `rate limit exceeded — max ${rl.limit} requests per hour` });

      const body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
      const messages = body?.messages || [];
      const userId = body?.userId || "trevor";
      const date = body?.date || new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());

      if (!messages.length) return response(400, { error: "messages required" });

      // Load current day + recent history + profile in parallel
      const [dayResult, recentDays, profileResult] = await Promise.all([
        ddb.send(new GetCommand({ TableName: DAYS_TABLE, Key: { date } })).catch(() => null),
        getRecentDays(7, date),
        ddb.send(new GetCommand({ TableName: PROFILES_TABLE, Key: { userId } })).catch(() => null),
      ]);

      const dayData = dayResult?.Item?.data
        ? (typeof dayResult.Item.data === "string" ? JSON.parse(dayResult.Item.data) : dayResult.Item.data)
        : { date, goal_calories: 2200, entries: [], exercise: [], totals: { calories_in: 0, calories_burned: 0, net: 0, protein: 0, carbs: 0, fat: 0 } };

      const profile = profileResult?.Item || {};

      // Build rich system prompt with full context
      const todayContext = (() => {
        const lines = [`Today is ${date}. Goal: ${dayData.goal_calories} cal.`];
        if (dayData.entries?.length) {
          lines.push("Today's entries: " + dayData.entries.map((e, i) => `[${i}] ${e.meal}: ${e.description} (${e.calories} cal, ${e.protein}g P)`).join("; "));
          const t = dayData.totals || {};
          lines.push(`Totals so far: ${t.calories_in} cal in | ${t.protein}g P | ${t.carbs}g C | ${t.fat}g F | ${t.calories_burned} burned | ${t.net} net`);
          lines.push(`Remaining: ${(dayData.goal_calories || 2200) - (t.calories_in || 0)} cal`);
        } else {
          lines.push("Nothing logged today yet.");
        }
        return lines.join("\n");
      })();

      const recentContext = recentDays.length > 0
        ? "Recent days:\n" + recentDays.map(d => {
            const t = d.totals || {};
            return `${d.date}: ${t.calories_in || 0} cal | ${t.protein || 0}g P | ${(d.entries || []).map(e => e.description || e.meal).join(", ")}`;
          }).join("\n")
        : "";

      const profileContext = profile.notes ? `User notes: ${profile.notes}` : "";

      const chatSystemPrompt = `You are a personal food and fitness journal assistant for Trevor (175lbs male, 2200 cal/day base goal).
You help him log meals, track nutrition, and understand his eating patterns.

${TREVOR_DEFAULTS}

${todayContext}

${recentContext}

${profileContext}

You can log food, edit entries, answer questions, and ask clarifying questions.
When you make changes, briefly confirm what you did.
If input is ambiguous, use Trevor's known defaults or ask.

Always respond with valid JSON (no markdown, no extra text):
{
  "message": "your conversational response",
  "mutations": [
    { "type": "add_entry", "entry": { "meal": "...", "description": "...", "items": [...], "calories": 0, "protein": 0, "carbs": 0, "fat": 0 } },
    { "type": "edit_entry", "entryIdx": 0, "patch": { "calories": 0 } },
    { "type": "add_exercise", "exercise": { "activity": "...", "duration_minutes": 0, "calories_burned": 0, "notes": "" } },
    { "type": "delete_entry", "entryIdx": 0 }
  ]
}
mutations is an empty array if just answering a question. All numbers are integers.`;

      // Route to haiku or sonnet based on message complexity
      const model = routeModel(messages);

      const rawResponse = await callClaude(messages, chatSystemPrompt, model, 1500);
      const cleaned = rawResponse.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
      let parsed;
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        // If Claude didn't return valid JSON (e.g. just a message), wrap it
        parsed = { message: rawResponse, mutations: [] };
      }

      const chatMessage = parsed.message || "";
      const mutations = parsed.mutations || [];

      // Apply mutations to dayData
      let mutationSummary = [];
      for (const m of mutations) {
        if (m.type === "add_entry" && m.entry) {
          dayData.entries = [...(dayData.entries || []), m.entry];
          mutationSummary.push(`+ ${m.entry.meal}: ${m.entry.description} (${m.entry.calories} cal)`);
        } else if (m.type === "add_exercise" && m.exercise) {
          dayData.exercise = [...(dayData.exercise || []), m.exercise];
          mutationSummary.push(`+ exercise: ${m.exercise.activity} (-${m.exercise.calories_burned} cal)`);
        } else if (m.type === "edit_entry" && m.patch !== undefined) {
          const idx = m.entryIdx;
          if (idx >= 0 && idx < (dayData.entries || []).length) {
            const before = dayData.entries[idx];
            dayData.entries[idx] = { ...before, ...m.patch };
            mutationSummary.push(`~ edited ${before.meal}`);
          }
        } else if (m.type === "delete_entry") {
          const idx = m.entryIdx;
          if (idx >= 0 && idx < (dayData.entries || []).length) {
            const removed = dayData.entries[idx];
            dayData.entries = dayData.entries.filter((_, i) => i !== idx);
            mutationSummary.push(`- removed ${removed.meal}: ${removed.description}`);
          }
        }
      }

      if (mutations.length > 0) {
        dayData.totals = computeTotals(dayData.entries, dayData.exercise);
        dayData.goal_calories = 2200 + (dayData.totals.calories_burned || 0);
        await ddb.send(new PutCommand({ TableName: DAYS_TABLE, Item: { date, data: dayData, updatedAt: ts() } }));
        await putEvent(date, "chat", userId, { mutations: mutationSummary, model });
      }

      return response(200, {
        ok: true,
        message: chatMessage,
        mutations: mutationSummary,
        model,
        totals: dayData.totals,
        goal_calories: dayData.goal_calories,
        entries: dayData.entries,
        exercise: dayData.exercise,
      });
    }

    return response(404, { error: "not found", path, method });
  } catch (err) {
    console.error("Error:", err);
    return response(500, { error: err.message });
  }
};
