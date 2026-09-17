// routes/departments.js
const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const { ACCESS_ROLES } = require('../constants/roles');
const {
  getAllDepartments,
  getDepartment,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  toggleDepartmentStatus,
} = require('../controllers/departmentController');

router.use(protect);

router
  .route('/')
  .get(getAllDepartments)
  .post(authorize(ACCESS_ROLES.HR_ADMIN, ACCESS_ROLES.SUPER_ADMIN), createDepartment);

router
  .route('/:id')
  .get(getDepartment)
  .put(authorize(ACCESS_ROLES.HR_ADMIN, ACCESS_ROLES.SUPER_ADMIN), updateDepartment)
  .delete(authorize(ACCESS_ROLES.SUPER_ADMIN), deleteDepartment);

router.patch(
  '/:id/toggle-status',
  authorize(ACCESS_ROLES.HR_ADMIN, ACCESS_ROLES.SUPER_ADMIN),
  toggleDepartmentStatus
);

module.exports = router;