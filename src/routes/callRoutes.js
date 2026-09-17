// routes/callRoutes.js
const express = require('express');
const router = express.Router();

const {
  startCall,
  acceptCall,
  declineCall,
  endCall,
  getCallById,
  getOngoingCalls,
} = require('../controllers/callController');

const { protect } = require('../middleware/auth');

router.use(protect);

// ─────────────────────────────────────────────
// Static routes
// ─────────────────────────────────────────────
router.post('/start', startCall);
router.post('/accept', acceptCall);
router.post('/decline', declineCall);
router.post('/end', endCall);

// ─────────────────────────────────────────────
// Parameterized routes — MUST come after static
// ─────────────────────────────────────────────
router.get('/ongoing/:userId', getOngoingCalls);
router.get('/:callId', getCallById);

module.exports = router;