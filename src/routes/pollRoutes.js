// routes/pollRoutes.js
const router = require('express').Router();
const { protect, hrAdminAndAbove } = require('../middleware/auth');

const {
  create,
  list,
  vote,
  results,
  edit,
  close,
  remove,
} = require('../controllers/pollController');

// Apply authentication to all routes
router.use(protect);

// ─────────────────────────────────────────────
// Static routes (any authenticated user)
// ─────────────────────────────────────────────
router.get('/', list);        // GET  /polls          - List all polls
router.post('/', hrAdminAndAbove, create);  // POST /polls - Create poll

// ─────────────────────────────────────────────
// Parameterized routes
// ─────────────────────────────────────────────
router.post('/:id/vote', vote);             // POST   /polls/:id/vote  - Vote
router.post('/:id/close', hrAdminAndAbove, close);   // POST   /polls/:id/close - Close
router.patch('/:id', hrAdminAndAbove, edit);         // PATCH  /polls/:id       - Edit
router.delete('/:id', hrAdminAndAbove, remove);      // DELETE /polls/:id       - Delete
router.get('/:id', results);                // GET    /polls/:id       - Results

module.exports = router;