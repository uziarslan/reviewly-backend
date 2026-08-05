const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeAnswerMap,
  buildAtomicAnswerSet,
  applyAnswerMap,
} = require("../utils/examAnswers");

test("normalizes legacy single-answer payloads", () => {
  assert.deepEqual(
    normalizeAnswerMap({ questionIndex: 2, selectedAnswer: "b" }, 4),
    { 2: "B" }
  );
});

test("normalizes batched answer snapshots and allows clearing an answer", () => {
  assert.deepEqual(
    normalizeAnswerMap({ answers: { 0: "A", 2: null, 3: "d" } }, 4),
    { 0: "A", 2: null, 3: "D" }
  );
});

test("rejects invalid indexes and answer values", () => {
  assert.throws(() => normalizeAnswerMap({ answers: { 4: "A" } }, 4), /Invalid question index/);
  assert.throws(() => normalizeAnswerMap({ answers: { 0: "E" } }, 4), /Invalid selected answer/);
});

test("builds isolated MongoDB field updates without replacing the answers array", () => {
  assert.deepEqual(buildAtomicAnswerSet({ 1: "C", 3: "A" }), {
    "answers.1.selectedAnswer": "C",
    "answers.3.selectedAnswer": "A",
  });
});

test("applies the final submitted snapshot before grading", () => {
  const answers = [
    { selectedAnswer: null },
    { selectedAnswer: "A" },
  ];
  applyAnswerMap(answers, { 0: "D", 1: "B" });
  assert.deepEqual(answers, [
    { selectedAnswer: "D" },
    { selectedAnswer: "B" },
  ]);
});
