const generatePassword = (length = 8) => {
  const charset =
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$';

  let password = '';

  for (let i = 0; i < length; i++) {
    password += charset.charAt(
      Math.floor(Math.random() * charset.length)
    );
  }

  return password;
};

// Calculate working days between two dates
const calculateWorkingDays = (startDate, endDate) => {
  let count = 0;
  let currentDate = new Date(startDate);
  const end = new Date(endDate);

  while (currentDate <= end) {
    const dayOfWeek = currentDate.getDay();

    // Exclude Saturday (6) and Sunday (0)
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      count++;
    }

    currentDate.setDate(currentDate.getDate() + 1);
  }

  return count;
};

// Format currency
const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
  }).format(amount);
};

// Calculate age
const calculateAge = (dateOfBirth) => {
  const today = new Date();
  const birthDate = new Date(dateOfBirth);

  let age = today.getFullYear() - birthDate.getFullYear();

  const monthDiff = today.getMonth() - birthDate.getMonth();

  if (
    monthDiff < 0 ||
    (monthDiff === 0 && today.getDate() < birthDate.getDate())
  ) {
    age--;
  }

  return age;
};

// Generate employee ID
const generateEmployeeId = async (User) => {
  const year = new Date().getFullYear().toString().slice(-2);
  const count = await User.countDocuments();

  const sequence = (count + 1).toString().padStart(4, '0');

  return `EMP${year}${sequence}`;
};

// Paginate results
const paginate = (query, page = 1, limit = 10) => {
  const skip = (page - 1) * limit;

  return query.skip(skip).limit(limit);
};

// Send success response
const sendSuccess = (res, data, statusCode = 200) => {
  res.status(statusCode).json({
    success: true,
    ...data,
  });
};

// Send error response
const sendError = (res, message, statusCode = 500) => {
  res.status(statusCode).json({
    success: false,
    message,
  });
};

module.exports = {
  generatePassword,
  calculateWorkingDays,
  formatCurrency,
  calculateAge,
  generateEmployeeId,
  paginate,
  sendSuccess,
  sendError,
};