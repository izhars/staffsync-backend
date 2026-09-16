// routes/geocode.js
const express = require("express");
const router = express.Router();

const OLA_MAPS_API_KEY = process.env.OLA_MAPS_API_KEY;

router.get("/autocomplete", async (req, res) => {
  const { input } = req.query;

  console.log("\n========== OLA MAPS AUTOCOMPLETE ==========");
  console.log("Time:", new Date().toISOString());
  console.log("Input:", input);
  console.log("API key loaded:", !!OLA_MAPS_API_KEY);

  if (!input || input.trim().length < 1) {
    console.log("❌ Empty input");
    return res.json({ predictions: [] });
  }

  if (!OLA_MAPS_API_KEY) {
    console.error("❌ OLA_MAPS_API_KEY is missing");
    return res.status(500).json({
      predictions: [],
      error: {
        message: "Ola Maps API key is not configured",
      },
    });
  }

  try {
    const url = `https://api.olamaps.io/places/v1/autocomplete?input=${encodeURIComponent(
      input
    )}`;

    console.log("➡️ Calling Ola Maps API");
    console.log("URL:", url);

    const olaRes = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${OLA_MAPS_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    console.log("Ola Status:", olaRes.status, olaRes.statusText);

    const data = await olaRes.json();

    console.log("Ola Response:", JSON.stringify(data, null, 2));

    if (!olaRes.ok) {
      console.error("❌ Ola Maps error:", data);

      return res.status(olaRes.status).json({
        predictions: [],
        error: data,
      });
    }

    console.log(
      "✅ Autocomplete successful. Results:",
      data?.predictions?.length || data?.results?.length || 0
    );

    console.log("==========================================\n");

    return res.json(data);
  } catch (err) {
    console.error("❌ Ola Maps autocomplete failed:", err);

    return res.status(500).json({
      predictions: [],
      error: "Autocomplete request failed",
    });
  }
});

module.exports = router;