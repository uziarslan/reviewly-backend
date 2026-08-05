const test = require("node:test");
const assert = require("node:assert/strict");
const Attempt = require("../models/Attempt");
const { saveAnswer } = require("../controllers/examController");

test("saveAnswer supports old clients and atomically batches new-client writes", async (t) => {
  const originalFindOne = Attempt.findOne;
  const originalFindOneAndUpdate = Attempt.findOneAndUpdate;
  t.after(() => {
    Attempt.findOne = originalFindOne;
    Attempt.findOneAndUpdate = originalFindOneAndUpdate;
  });

  Attempt.findOne = () => ({
    select: async () => ({ answers: [{}, {}, {}, {}] }),
  });

  const updates = [];
  Attempt.findOneAndUpdate = async (_filter, update) => {
    updates.push(update.$set);
    return { _id: "attempt-123" };
  };

  const invoke = async (body) => {
    let response;
    let forwardedError;
    await saveAnswer(
      { params: { attemptId: "attempt-123" }, user: { _id: "user-123" }, body },
      { json: (value) => { response = value; }, status: () => ({ json: () => {} }) },
      (err) => { forwardedError = err; }
    );
    assert.equal(forwardedError, undefined);
    assert.deepEqual(response, { success: true });
  };

  await invoke({ questionIndex: 1, selectedAnswer: "C", remainingSeconds: 100 });
  await invoke({ answers: { 0: "A", 3: "D" }, currentIndex: 3, remainingSeconds: 90 });

  assert.equal(updates[0]["answers.1.selectedAnswer"], "C");
  assert.equal(updates[0].currentIndex, 1);
  assert.equal(updates[0].remainingSeconds, 100);
  assert.equal(updates[1]["answers.0.selectedAnswer"], "A");
  assert.equal(updates[1]["answers.3.selectedAnswer"], "D");
  assert.equal(updates[1].currentIndex, 3);
  assert.equal(updates[1].remainingSeconds, 90);
});
