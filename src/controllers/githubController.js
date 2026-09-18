// controllers/githubController.js
const { pushToGithub, getRepoStatus } = require('../services/git.service');

/**
 * @desc   Push project code to GitHub
 * @route  POST /api/github/push
 * @access Private (Super Admin only)
 */
exports.pushCode = async (req, res, next) => {
  try {
    const { message } = req.body;
    const result = await pushToGithub(message);

    res.status(200).json({
      success: true,
      message: '✅ Code pushed to GitHub successfully',
      data: result,
      pushedBy: {
        id: req.user._id,
        name: req.user.name,
        role: req.user.role,
      },
    });
  } catch (err) {
    console.error('❌ GitHub push failed:', err.message);
    res.status(500).json({
      success: false,
      message: 'GitHub push failed',
      error: err.message,
    });
  }
};

/**
 * @desc   Get current repo status
 * @route  GET /api/github/status
 * @access Private (Super Admin only)
 */
exports.getStatus = async (req, res, next) => {
  try {
    const status = await getRepoStatus();
    res.status(200).json({ success: true, data: status });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch repo status',
      error: err.message,
    });
  }
};