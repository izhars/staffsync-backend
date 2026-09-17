// src/routes/projectRoutes.js
const express = require('express');
const router = express.Router();

const {
  createProject,
  getAllProjects,
  getProject,
  updateProject,
  deleteProject,
  addExpense,
  getExpenseHistory,
  isUserInProject,
  getMyExpenseHistory,
} = require('../controllers/projectController');

const {
  addTeamMember,
  updateTeamMember,
  removeTeamMember,
  getTeamMembers,
} = require('../controllers/teamController');

const {
  addResponsibility,
  getProjectResponsibilities,
} = require('../controllers/roleController');

const { protect, managerAndAbove } = require('../middleware/auth');

// Apply auth to all routes
router.use(protect);

/* =========================
   📦 Project Routes
========================= */

// 👀 Read → anyone logged in
router.route('/')
  .get(getAllProjects)
  .post(managerAndAbove, createProject);

router.route('/:id')
  .get(getProject)
  .put(managerAndAbove, updateProject)
  .delete(managerAndAbove, deleteProject);

/* =========================
   👥 Team Members
========================= */

router.route('/:projectId/team-members')
  .get(getTeamMembers)
  .post(managerAndAbove, addTeamMember);

router.route('/:projectId/team-members/:memberId')
  .put(managerAndAbove, updateTeamMember)
  .delete(managerAndAbove, removeTeamMember);

/* =========================
   🎯 Responsibilities
========================= */

router.route('/:projectId/responsibilities')
  .get(getProjectResponsibilities)
  .post(managerAndAbove, addResponsibility);

/* =========================
   💸 Expenses / Spending
========================= */

// ⚠️ Static sub-path MUST come before the parameterized one
router.get('/:id/expenses/me', getMyExpenseHistory);

router.route('/:id/expenses')
  .post(addExpense)
  .get(getExpenseHistory);

/* =========================
   ✅ Check if user is member of project
========================= */

router.route('/:projectId/is-member')
  .get(isUserInProject);

module.exports = router;