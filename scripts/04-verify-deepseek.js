// Step 7 verification: proves the replacement DeepSeek key and model work before
// they are added to n8n. Run with: node --env-file=.env scripts/04-verify-deepseek.js

const {
  DEEPSEEK_API_KEY,
  DEEPSEEK_API_BASE = "https://api.deepseek.com",
  DEEPSEEK_MODEL = "deepseek-v4-flash",
  DEEPSEEK_MAX_TOKENS = "64",
} = process.env;

const missing = ["DEEPSEEK_API_KEY"].filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing required environment variable(s): ${missing.join(", ")}`);
  process.exit(1);
}

const url = `${DEEPSEEK_API_BASE.replace(/\/$/, "")}/chat/completions`;
const body = {
  model: DEEPSEEK_MODEL,
  thinking: { type: "disabled" },
  max_tokens: Number.parseInt(DEEPSEEK_MAX_TOKENS, 10),
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Reply with exactly: DeepSeek connection verified" },
  ],
};

console.log(`POST ${url} using model=${DEEPSEEK_MODEL}`);

const response = await fetch(url, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});

const data = await response.json().catch(() => null);
console.log(`HTTP ${response.status}`);

if (!response.ok) {
  console.error(JSON.stringify(data, null, 2));
  process.exit(1);
}

console.log(`Reply: ${data?.choices?.[0]?.message?.content ?? "<missing>"}`);
console.log(`Usage: ${JSON.stringify(data?.usage ?? {})}`);
