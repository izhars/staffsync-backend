// routes/shifts.js
const express = require('express');
const router = express.Router();

const {
    createShift,
    getShifts,
    getShift,
    updateShift,
    deleteShift,
    assignShift,
    unassignShift,
    getShiftUsers,
    getAvailableShifts,
    setDefaultShift,
    getShiftStats,
    getMyShift
} = require('../controllers/shiftController');

const { protect, hrAndAbove } = require('../middleware/auth');

// ── All routes require authentication ───────────────────────────
router.use(protect);

// ── Employee-accessible ─────────────────────────────────────────
router.get('/available', getAvailableShifts);
router.get('/my-shift', getMyShift);

// ── HR Admin / Superadmin only ──────────────────────────────────
router.post('/', hrAndAbove, createShift);
router.get('/', getShifts);
router.get('/stats', hrAndAbove, getShiftStats);
router.get('/:id', getShift);
router.put('/:id', hrAndAbove, updateShift);
router.delete('/:id', hrAndAbove, deleteShift);

router.patch('/assign', hrAndAbove, assignShift);
router.patch('/unassign', hrAndAbove, unassignShift);
router.patch('/:id/set-default', hrAndAbove, setDefaultShift);
router.get('/:id/users', hrAndAbove, getShiftUsers);

module.exports = router;