const router = require("express").Router();
const { listGeminiModels, testGeminiModel } = require("../utils/gemini");

/**
 * GET /api/ai/test
 * Optional query: ?model=gemini-1.5-flash-latest
 * Returns available models and a quick test (if model provided).
 */
router.get("/test", async (req, res) => {
  try {
    const models = await listGeminiModels();
    if (!models) {
      return res.status(503).json({
        success: false,
        message: "Gemini not configured or SDK not installed",
      });
    }

    const model = req.query.model ? String(req.query.model) : null;
    let test = null;
    if (model) {
      try {
        test = await testGeminiModel(model);
      } catch (err) {
        test = { ok: false, error: err?.message || String(err) };
      }
    }

    res.json({
      success: true,
      data: {
        models,
        test,
      },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err?.message || "Failed to list Gemini models",
    });
  }
});

module.exports = router;
