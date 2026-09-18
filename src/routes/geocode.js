const express = require('express');

const router = express.Router();

const OLA_KEY = process.env.OLA_MAPS_API_KEY;

router.post('/route', async (req, res) => {
  try {
    const { origin, destination, waypoints } = req.query;

    if (!origin || !destination) {
      return res.status(400).json({
        success: false,
        message: 'origin and destination are required',
      });
    }

    if (!OLA_KEY) {
      return res.status(500).json({
        success: false,
        message: 'OLA_MAPS_API_KEY is not configured',
      });
    }

    const params = new URLSearchParams({
      origin,
      destination,
      overview: 'full',
      api_key: OLA_KEY,
    });

    if (waypoints) {
      params.append('waypoints', waypoints);
    }

    const olaRes = await fetch(
      `https://api.olamaps.io/routing/v1/directions?${params}`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'X-Request-Id': Date.now().toString(),
        },
      }
    );

    const data = await olaRes.json();

    return res.status(olaRes.status).json(data);
  } catch (err) {
    console.error('OLA route error:', err);

    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

module.exports = router;