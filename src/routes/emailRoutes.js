// routes/emailRoutes.js
const express = require('express');
const router = express.Router();
const emailService = require('../utils/emailService');
const { protect, authorize } = require('../middleware/auth');
const { ACCESS_ROLES } = require('../constants/roles');

// Verify email configuration (Admin only)
router.get('/verify', protect, authorize(ACCESS_ROLES.HR_ADMIN, ACCESS_ROLES.SUPER_ADMIN), async (req, res) => {
  try {
    await emailService.verifyEmailConfig();
    res.json({
      success: true,
      message: 'Email service is configured correctly'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get email service stats (Admin only)
router.get('/stats', protect, authorize(ACCESS_ROLES.HR_ADMIN, ACCESS_ROLES.SUPER_ADMIN), async (req, res) => {
  try {
    const stats = await emailService.getEmailStats();
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Send test email (Admin/HR only)
router.post('/test', protect, authorize(ACCESS_ROLES.HR_ADMIN, ACCESS_ROLES.SUPER_ADMIN), async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }

    await emailService.clearTemplateCache();
    const result = await emailService.sendTestEmail(email);

    res.json({
      success: true,
      message: 'Test email sent successfully',
      messageId: result.messageId
    });
  } catch (error) {
    console.error('🔥 Test email error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Send announcement email (Admin/HR only)
router.post('/announcement', protect, authorize(ACCESS_ROLES.HR_ADMIN, ACCESS_ROLES.SUPER_ADMIN), async (req, res) => {
  try {
    const { recipients, title, message, priority } = req.body;

    if (!recipients || !recipients.length || !title || !message) {
      return res.status(400).json({
        success: false,
        error: 'Recipients, title, and message are required'
      });
    }

    const announcement = {
      title,
      message,
      priority: priority || 'normal',
      author: `${req.user.firstName} ${req.user.lastName}`,
      date: new Date()
    };

    const result = await emailService.sendAnnouncementEmail(
      recipients,
      announcement
    );

    res.json({
      success: true,
      message: 'Announcement emails sent',
      stats: result
    });
  } catch (error) {
    console.error('Announcement email error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Send bulk email (Admin only)
router.post('/bulk', protect, authorize(ACCESS_ROLES.HR_ADMIN, ACCESS_ROLES.SUPER_ADMIN), async (req, res) => {
  try {
    const { emails, subject, html, options } = req.body;

    if (!emails || !emails.length || !subject || !html) {
      return res.status(400).json({
        success: false,
        error: 'Emails, subject, and html content are required'
      });
    }

    const result = await emailService.sendBulkEmail(
      emails,
      subject,
      html,
      options
    );

    res.json({
      success: true,
      message: 'Bulk email sent',
      stats: result
    });
  } catch (error) {
    console.error('Bulk email error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Clear template cache (Admin only)
router.post('/clear-cache', protect, authorize(ACCESS_ROLES.HR_ADMIN, ACCESS_ROLES.SUPER_ADMIN), async (req, res) => {
  try {
    emailService.clearTemplateCache();
    res.json({
      success: true,
      message: 'Template cache cleared successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Send custom email (Admin/HR only)
router.post('/send', protect, authorize(ACCESS_ROLES.HR_ADMIN, ACCESS_ROLES.SUPER_ADMIN), async (req, res) => {
  try {
    const { to, subject, html, text, attachments } = req.body;

    if (!to || !subject || (!html && !text)) {
      return res.status(400).json({
        success: false,
        error: 'To, subject, and content (html or text) are required'
      });
    }

    const result = await emailService.sendEmail({
      to,
      subject,
      html,
      text,
      attachments
    });

    res.json({
      success: true,
      message: 'Email sent successfully',
      messageId: result.messageId
    });
  } catch (error) {
    console.error('Send email error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;