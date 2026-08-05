const test = require("node:test");
const assert = require("node:assert/strict");
const Attempt = require("../models/Attempt");
const { submitExam } = require("../controllers/examController");

test("a retry returns the result already committed in MongoDB", async (t) => {
  const originalFindOne = Attempt.findOne;
  t.after(() => {
    Attempt.findOne = originalFindOne;
  });

  const storedAttempt = {
    _id: "attempt-123",
    status: "submitted",
    result: { percentage: 82, correct: 82 },
  };
  Attempt.findOne = () => ({
    populate: async () => storedAttempt,
  });

  let responseBody;
  let forwardedError;
  await submitExam(
    { params: { attemptId: "attempt-123" }, user: { _id: "user-123" }, body: {} },
    { json: (body) => { responseBody = body; } },
    (err) => { forwardedError = err; }
  );

  assert.equal(forwardedError, undefined);
  assert.deepEqual(responseBody, {
    success: true,
    alreadySubmitted: true,
    data: {
      attemptId: "attempt-123",
      result: { percentage: 82, correct: 82 },
    },
  });
});
