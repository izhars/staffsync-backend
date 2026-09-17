// routes/taskRoutes.js
const express = require('express');
const router = express.Router();

const { protect, hrAdminAndAbove, managerAndAbove } = require('../middleware/auth');

const {
  getTasks,
  getTask,
  createTask,
  updateTask,
  completeTask,
  addComment,
  deleteTask,
} = require('../controllers/taskController');

router.use(protect);

// ─────────────────────────────────────────────
// Static / collection routes
// ─────────────────────────────────────────────
router.get('/', getTasks);
router.post('/', managerAndAbove, createTask);

// ─────────────────────────────────────────────
// Parameterized routes
// ─────────────────────────────────────────────
router.get('/:id', getTask);
router.patch('/:id', managerAndAbove, updateTask);
router.delete('/:id', hrAdminAndAbove, deleteTask);

router.post('/:id/complete', completeTask);
router.post('/:id/comments', addComment);

module.exports = router;