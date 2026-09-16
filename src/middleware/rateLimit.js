const rateLimit = require('express-rate-limit');

const createRateLimit = (windowMs, max, message) => {
  return rateLimit({
    windowMs,
    max,
    message: { success: false, message },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({
        success: false,
        message: message
      });
    }
  });
};

module.exports = {
  loginLimiter: createRateLimit(1 * 60 * 1000, 20, 'Too many login attempts, try again later'),
  registerLimiter: createRateLimit(60 * 60 * 1000, 10, 'Too many registrations, try again in an hour'),
  apiLimiter: createRateLimit(15 * 60 * 1000, 100, 'Too many requests')
};