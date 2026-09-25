const express = require('express');
const router = express.Router();

const { protect, hrAdminAndAbove } = require('../middleware/auth');

const {
  generatePayroll,
  getAllPayrolls,
  getPayrollById,
  getMyPayroll,
  updatePayroll,
  processPayroll,
  markAsPaid,
} = require('../controllers/payrollController');

// All routes below require login
router.use(protect);

// ─────────────────────────────────────────────
// Static routes (must come BEFORE /:id)
// ─────────────────────────────────────────────
router.post('/generate', hrAdminAndAbove, generatePayroll);
router.get('/', hrAdminAndAbove, getAllPayrolls);
router.get('/my-payroll', getMyPayroll);

// ─────────────────────────────────────────────
// Parameterized routes
// ─────────────────────────────────────────────
router.get('/:id', getPayrollById);                 // NEW — access-checked inside
router.put('/:id', hrAdminAndAbove, updatePayroll);
router.put('/:id/process', hrAdminAndAbove, processPayroll);
router.put('/:id/pay', hrAdminAndAbove, markAsPaid);

module.exports = router;