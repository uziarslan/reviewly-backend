let GoogleGenerativeAI = null;
try {
  ({ GoogleGenerativeAI } = require("@google/generative-ai"));
} catch (_) {
  // Optional dependency; keep null if not installed.
}

const DEFAULT_MODEL = "gemini-1.5-flash-002";

function buildPrompt({ totalItems, correct, percentage, sectionScores, passed, passingThreshold }) {
  const sections = sectionScores.map((s) => ({
    section: s.section,
    totalItems: s.totalItems,
    correct: s.correct,
    incorrect: s.incorrect,
    unanswered: s.unanswered,
    score: s.score,
  }));

  // Sort sections by score to identify strong/weak areas
  const sorted = [...sections].sort((a, b) => b.score - a.score);
  const strongSections = sorted.slice(0, 2).map((s) => s.section);
  const weakestSection = sorted[sorted.length - 1]?.section || "";

  return [
    "You are an exam coach for a Civil Service Exam reviewer app called Reviewly.",
    "Analyze the user's test performance and return ONLY valid JSON (no markdown, no extra keys).",
    "",
    "Return JSON with this exact shape:",
    "{",
    '  "quickSummary": "string - 2-3 sentences summarizing overall performance. Mention which sections were strong, which need work. Supportive and diagnostic tone.",',
    '  "sectionAnalysis": [',
    '    {',
    '      "section": "string - exact section name from input",',
    '      "lines": ["string - first descriptive line about performance", "string - second line with actionable advice"]',
    '    }',
    "  ],",
    '  "strengths": ["string", "string", "string"],',
    '  "improvements": ["string", "string", "string", "string"],',
    '  "summary": "string - 2-3 sentences, encouraging, actionable"',
    "}",
    "",
    "Guidelines for sectionAnalysis:",
    "- Provide exactly one entry per section from the input data.",
    "- Each entry must have exactly 2 lines (short, specific, actionable).",
    `- For strong sections (${strongSections.join(", ")}): praise specific skills, mention exam-readiness.`,
    `- For the weakest section (${weakestSection}): mention it had the biggest impact on overall score, suggest specific practice areas.`,
    "- For mid-range sections: acknowledge progress, suggest targeted refinement.",
    "- Tone: calm, supportive, professional, encouraging. Never say 'you will fail'.",
    "",
    "Guidelines for strengths/improvements/summary (backward compat):",
    "- Strengths: 2-3 short, specific skill or section names.",
    "- Improvements: 3-4 short, specific skill or section names.",
    "- Summary: 2-3 sentences, encouraging, actionable.",
    "",
    "Performance data:",
    JSON.stringify({
      totalItems,
      correct,
      percentage,
      passed: passed != null ? passed : undefined,
      passingThreshold: passingThreshold || undefined,
      sections,
    }),
  ].join("\n");
}

function buildPracticePrompt({ totalItems, correct, percentage, unanswered, timeSpentSeconds, sectionName }) {
  const avgTimePerQ = totalItems > 0 && timeSpentSeconds ? Math.round(timeSpentSeconds / totalItems) : null;
  let performanceLevel = 'Needs Improvement';
  if (percentage >= 85) performanceLevel = 'Strong';
  else if (percentage >= 70) performanceLevel = 'Developing';

  return [
    "You are an exam coach for a Civil Service Exam reviewer app called Reviewly.",
    `The user just completed a section practice exam for: ${sectionName}.`,
    "This is a single-section practice exam with 50 items. It is NOT a full mock exam.",
    "Return ONLY valid JSON (no markdown, no extra keys).",
    "",
    "Return JSON with this exact shape:",
    "{",
    '  "quickSummary": "string - 2-3 short sentences about the user\'s performance in this specific section. Mention specific skills tested (e.g., computation, word problems, grammar, patterns). Supportive and focused tone. Do NOT mention other sections.",',
    '  "timeInsight": "string - one sentence about pacing based on unanswered count. If 0 unanswered: good pacing. If 1-2: slight pacing issue. If 3+: pacing needs work."',
    "}",
    "",
    "Guidelines:",
    `- Performance level: ${performanceLevel}`,
    "- If Strong (85%+): praise consistency, mention exam-readiness for this section.",
    "- If Developing (70-84%): acknowledge progress, suggest specific refinement areas.",
    "- If Needs Improvement (<70%): be encouraging, mention structured practice and pacing.",
    "- Keep it short, 2-3 lines max for quickSummary.",
    "- Tone: calm, supportive, professional. Never say 'you will fail'.",
    "",
    "Performance data:",
    JSON.stringify({
      sectionName,
      totalItems,
      correct,
      incorrect: totalItems - correct - (unanswered || 0),
      unanswered: unanswered || 0,
      percentage,
      performanceLevel,
      timeSpentSeconds: timeSpentSeconds || null,
      avgTimePerQuestion: avgTimePerQ,
    }),
  ].join("\n");
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

async function generateGeminiAnalysis({ totalItems, correct, percentage, sectionScores, passed, passingThreshold, examType, unanswered, timeSpentSeconds, sectionName }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !GoogleGenerativeAI) return null;

  const genAI = new GoogleGenerativeAI(apiKey);
  const isPractice = examType === 'practice';
  const prompt = isPractice
    ? buildPracticePrompt({ totalItems, correct, percentage, unanswered, timeSpentSeconds, sectionName })
    : buildPrompt({ totalItems, correct, percentage, sectionScores, passed, passingThreshold });

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

  // For practice exams, different validation
  if (isPractice) {
    if (!parsed || typeof parsed.quickSummary !== "string") {
      return null;
    }
    return {
      quickSummary: parsed.quickSummary,
      timeInsight: typeof parsed.timeInsight === "string" ? parsed.timeInsight : null,
      // Provide empty defaults for backward compat fields
      strengths: [],
      improvements: [],
      summary: null,
      sectionAnalysis: [],
    };
  }

  if (!parsed || !Array.isArray(parsed.strengths) || !Array.isArray(parsed.improvements)) {
    return null;
  }

  return {
    strengths: parsed.strengths.slice(0, 3),
    improvements: parsed.improvements.slice(0, 4),
    summary: typeof parsed.summary === "string" ? parsed.summary : null,
    quickSummary: typeof parsed.quickSummary === "string" ? parsed.quickSummary : null,
    sectionAnalysis: Array.isArray(parsed.sectionAnalysis)
      ? parsed.sectionAnalysis.map((sa) => ({
          section: sa.section || "",
          lines: Array.isArray(sa.lines) ? sa.lines.slice(0, 3) : [],
        }))
      : [],
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
