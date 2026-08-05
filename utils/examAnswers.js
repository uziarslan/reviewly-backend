const VALID_ANSWERS = new Set(["A", "B", "C", "D"]);

function validationError(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

/**
 * Accept both the legacy single-answer payload and the newer answer-map payload.
 * Returns a normalized object keyed by zero-based question index.
 */
function normalizeAnswerMap(payload, answerCount, { ignoreInvalid = false } = {}) {
  const body = payload && typeof payload === "object" ? payload : {};
  let source = {};

  if (body.answers && typeof body.answers === "object" && !Array.isArray(body.answers)) {
    source = body.answers;
  } else if (body.questionIndex !== undefined) {
    source = { [body.questionIndex]: body.selectedAnswer };
  }

  const normalized = {};
  for (const [rawIndex, rawAnswer] of Object.entries(source)) {
    const index = Number(rawIndex);
    const answer = rawAnswer == null || rawAnswer === ""
      ? null
      : String(rawAnswer).trim().toUpperCase();
    const validIndex = Number.isInteger(index) && index >= 0 && index < answerCount;
    const validAnswer = answer === null || VALID_ANSWERS.has(answer);

    if (!validIndex || !validAnswer) {
      if (ignoreInvalid) continue;
      throw validationError(!validIndex ? "Invalid question index" : "Invalid selected answer");
    }

    normalized[index] = answer;
  }

  return normalized;
}

function buildAtomicAnswerSet(answerMap) {
  const update = {};
  for (const [index, answer] of Object.entries(answerMap)) {
    update[`answers.${index}.selectedAnswer`] = answer;
  }
  return update;
}

function applyAnswerMap(answerDocs, answerMap) {
  for (const [rawIndex, answer] of Object.entries(answerMap)) {
    const index = Number(rawIndex);
    if (!answerDocs[index]) throw validationError("Exam answer data is incomplete");
    answerDocs[index].selectedAnswer = answer;
  }
}

module.exports = {
  normalizeAnswerMap,
  buildAtomicAnswerSet,
  applyAnswerMap,
};
