let GoogleGenerativeAI = null;
try {
  ({ GoogleGenerativeAI } = require("@google/generative-ai"));
} catch (_) {
  // Optional dependency; keep null if not installed.
}

const DEFAULT_MODEL = "gemini-1.5-flash-002";

function buildPrompt({ totalItems, correct, percentage, sectionScores }) {
  const sections = sectionScores.map((s) => ({
    section: s.section,
    totalItems: s.totalItems,
    correct: s.correct,
    incorrect: s.incorrect,
    unanswered: s.unanswered,
    score: s.score,
  }));

  return [
    "You are an exam coach. Analyze the user's test performance.",
    "Return ONLY valid JSON with this shape:",
    "{\"strengths\":[string,string,string],\"improvements\":[string,string,string,string],\"summary\":string}",
    "Guidelines:",
    "- Strengths: 2-3 short, specific skill or section names.",
    "- Improvements: 3-4 short, specific skill or section names.",
    "- Summary: 2-3 sentences, encouraging, actionable.",
    "- No extra keys, no markdown.",
    "\nPerformance data:",
    JSON.stringify({ totalItems, correct, percentage, sections }),
  ].join("\n");
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

async function generateGeminiAnalysis({ totalItems, correct, percentage, sectionScores }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !GoogleGenerativeAI) return null;

  const genAI = new GoogleGenerativeAI(apiKey);
  const prompt = buildPrompt({ totalItems, correct, percentage, sectionScores });

  const candidates = [
    process.env.GEMINI_MODEL,
    DEFAULT_MODEL,
    "gemini-1.5-flash-latest",
    "gemini-1.5-pro-002",
    "gemini-1.0-pro",
  ].filter(Boolean);

  let parsed = null;
  for (const modelName of candidates) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      const text = result?.response?.text?.() || "";
      parsed = safeParseJson(text);
      if (parsed) break;
    } catch (err) {
      // Try next model if this one is not available.
      const msg = err?.message || "";
      if (!msg.includes("not found") && !msg.includes("NOT_FOUND")) {
        throw err;
      }
    }
  }

  if (!parsed || !Array.isArray(parsed.strengths) || !Array.isArray(parsed.improvements)) {
    return null;
  }

  return {
    strengths: parsed.strengths.slice(0, 3),
    improvements: parsed.improvements.slice(0, 4),
    summary: typeof parsed.summary === "string" ? parsed.summary : null,
  };
}

async function listGeminiModels() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !GoogleGenerativeAI) return null;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ListModels failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  const models = data?.models || [];
  return models.map((m) => ({
    name: m.name,
    displayName: m.displayName,
    supportedMethods: m.supportedMethods,
  }));
}

async function testGeminiModel(modelName) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !GoogleGenerativeAI || !modelName) return null;

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });
  const result = await model.generateContent("ping");
  const text = result?.response?.text?.() || "";
  return { ok: true, sample: text.slice(0, 120) };
}

module.exports = { generateGeminiAnalysis, listGeminiModels, testGeminiModel };
