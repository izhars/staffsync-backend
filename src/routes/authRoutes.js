// routes/auth.js
const express = require('express');
const router = express.Router();
const { profileUpload } = require('../middleware/upload');

const {
  register,
  login,
  logout,
  getMe,
  updateProfile,
  changePassword,
  forgotPassword,
  resetPassword,
  getManagers,
  assignManager,
  resetDevice,
  setVerification,
  checkVerification,
  updateProfilePicture,
} = require('../controllers/authController');

const { protect, hrAndAbove } = require('../middleware/auth');
const { registerValidator, loginValidator } = require('../validators/authValidator');
const { loginLimiter, registerLimiter } = require('../middleware/rateLimit');

// ── Public ──────────────────────────────────────────────────────
router.post('/login', loginValidator, loginLimiter, login);
router.post('/forgot-password', forgotPassword);
router.put('/reset-password/:token', resetPassword);

// ── Protected (HR Admin / Superadmin) ───────────────────────────
router.post('/register', protect, hrAndAbove, registerValidator, registerLimiter, register);
router.put('/reset-device/:userId', protect, hrAndAbove, resetDevice);
router.put('/verify/:userId',       protect, hrAndAbove, setVerification);
router.get('/managers',             protect, hrAndAbove, getManagers);
router.patch('/assign-manager/:userId', protect, hrAndAbove, assignManager);

// ── Authenticated user routes ───────────────────────────────────
router.use(protect);

router.post('/logout', logout);    // ← ADD THIS LINE
router.get('/me', getMe);
router.put('/profile', updateProfile);
router.put('/change-password', changePassword);
router.get('/check-verification', checkVerification);
router.put('/profile-picture', profileUpload.single('file'), updateProfilePicture);

module.exports = router;