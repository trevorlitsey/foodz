#!/usr/bin/env node
/**
 * foodz-api — REST API over food journal JSON files
 * endpoints:
 *   GET  /api/dates          → list of logged dates
 *   GET  /api/day/:date      → day data (YYYY-MM-DD)
 *   GET  /api/today          → today's data
 *   GET  /api/recent?n=7     → last N days
 *   POST /api/log            → submit plain-English food/exercise log
 *   GET  /api/log/:id        → check processing status of a submitted log
 *   GET  /health             → health check
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3030;
const DATA_DIR = process.env.DATA_DIR || '/home/trevorlitsey/.openclaw/workspace/food-journal';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ── In-memory job store ──
const jobs = new Map(); // id → { status: 'processing'|'done'|'error', result?, error?, createdAt }

// ── Helpers ──

function today() {
  const d = new Date();
  const tz = 'America/Chicago';
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function getDates() {
  const files = fs.readdirSync(DATA_DIR)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map(f => f.replace('.json', ''))
    .sort();
  return files;
}

function cors(res, method = 'GET') {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res, data, status = 200) {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function notFound(res, msg = 'not found') {
  json(res, { error: msg }, 404);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });
}

// ── OpenAI parser ──

const PARSE_SYSTEM_PROMPT = `You are a food and fitness journal parser for Trevor (175lbs male, 2200 cal/day base goal).
Parse plain English input describing food eaten or exercise done into structured JSON.

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
- description should be concise and natural (like "oatmeal with peanut butter and maple syrup")`;

function callOpenAI(text) {
  return new Promise((resolve, reject) => {
    if (!OPENAI_API_KEY) {
      reject(new Error('OPENAI_API_KEY not set'));
      return;
    }

    const body = JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: PARSE_SYSTEM_PROMPT },
        { role: 'user', content: text }
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' }
    });

    const options = {
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) { reject(new Error(parsed.error.message)); return; }
          const content = parsed.choices[0].message.content;
          resolve(JSON.parse(content));
        } catch (e) {
          reject(new Error('Failed to parse OpenAI response: ' + e.message));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Journal update logic ──

function recalcTotals(day) {
  let cal_in = 0, burned = 0, protein = 0, carbs = 0, fat = 0;
  (day.entries || []).forEach(e => {
    cal_in += e.calories || 0;
    protein += e.protein || 0;
    carbs   += e.carbs   || 0;
    fat     += e.fat     || 0;
  });
  (day.exercise || []).forEach(e => {
    burned += e.calories_burned || 0;
  });
  day.totals = {
    calories_in: cal_in,
    calories_burned: burned,
    net: cal_in - burned,
    protein,
    carbs,
    fat
  };
  day.goal_calories = 2200 + burned;
  return day;
}

async function processLog(text, date) {
  // 1. Parse with AI
  const parsed = await callOpenAI(text);

  const entries  = parsed.entries  || [];
  const exercise = parsed.exercise || [];

  if (entries.length === 0 && exercise.length === 0) {
    throw new Error('Could not parse any food or exercise from that input. Try being more specific.');
  }

  // 2. Read or create day file
  const filePath = path.join(DATA_DIR, `${date}.json`);
  let day = readJson(filePath) || {
    date,
    goal_calories: 2200,
    entries: [],
    exercise: [],
    totals: { calories_in: 0, calories_burned: 0, net: 0, protein: 0, carbs: 0, fat: 0 }
  };

  // 3. Append
  day.entries  = [...(day.entries  || []), ...entries];
  day.exercise = [...(day.exercise || []), ...exercise];

  // 4. Recalculate totals
  recalcTotals(day);

  // 5. Write
  writeJson(filePath, day);

  return { entries, exercise, totals: day.totals, goal_calories: day.goal_calories };
}

// ── HTTP Server ──

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // OPTIONS preflight
  if (req.method === 'OPTIONS') {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // ── POST /api/log ──
  if (req.method === 'POST' && pathname === '/api/log') {
    let body;
    try {
      body = await readBody(req);
    } catch {
      return json(res, { error: 'invalid JSON body' }, 400);
    }

    const text = (body.text || '').trim();
    if (!text) return json(res, { error: 'text is required' }, 400);

    const date = body.date || today();
    const id = crypto.randomUUID();

    jobs.set(id, { status: 'processing', createdAt: Date.now() });

    // Process async
    processLog(text, date).then(result => {
      jobs.set(id, { status: 'done', result, createdAt: jobs.get(id)?.createdAt });
    }).catch(err => {
      jobs.set(id, { status: 'error', error: err.message, createdAt: jobs.get(id)?.createdAt });
    });

    return json(res, { id, status: 'processing' }, 202);
  }

  if (req.method !== 'GET') {
    json(res, { error: 'method not allowed' }, 405);
    return;
  }

  // ── GET /health ──
  if (pathname === '/health') {
    json(res, { ok: true, ts: new Date().toISOString() });
    return;
  }

  // ── GET /api/dates ──
  if (pathname === '/api/dates') {
    const dates = getDates();
    json(res, { dates });
    return;
  }

  // ── GET /api/today ──
  if (pathname === '/api/today') {
    const date = today();
    const filePath = path.join(DATA_DIR, `${date}.json`);
    const data = readJson(filePath);
    if (!data) {
      json(res, { date, entries: [], exercise: [], totals: { calories_in: 0, calories_burned: 0, net: 0, protein: 0, carbs: 0, fat: 0 }, goal_calories: 2200 });
    } else {
      json(res, data);
    }
    return;
  }

  // ── GET /api/recent?n=7 ──
  if (pathname === '/api/recent') {
    const n = Math.min(parseInt(url.searchParams.get('n') || '7', 10), 30);
    const dates = getDates().slice(-n);
    const days = dates.map(date => {
      const filePath = path.join(DATA_DIR, `${date}.json`);
      return readJson(filePath);
    }).filter(Boolean);
    json(res, { days });
    return;
  }

  // ── GET /api/log/:id ──
  const logMatch = pathname.match(/^\/api\/log\/([a-f0-9-]{36})$/);
  if (logMatch) {
    const id = logMatch[1];
    const job = jobs.get(id);
    if (!job) return notFound(res, 'job not found');
    return json(res, { id, ...job });
  }

  // ── GET /api/day/:date ──
  const match = pathname.match(/^\/api\/day\/(\d{4}-\d{2}-\d{2})$/);
  if (match) {
    const date = match[1];
    const filePath = path.join(DATA_DIR, `${date}.json`);
    const data = readJson(filePath);
    if (!data) return notFound(res, `no data for ${date}`);
    json(res, data);
    return;
  }

  notFound(res);
});

server.listen(PORT, () => {
  console.log(`foodz-api listening on port ${PORT}`);
  console.log(`data dir: ${DATA_DIR}`);
  console.log(`openai: ${OPENAI_API_KEY ? 'configured ✓' : 'NOT CONFIGURED ✗'}`);
});
