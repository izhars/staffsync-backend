// middleware/validateHolidayInput.js

const validateHolidayInput = (req, res, next) => {
  // ✅ Support both single object and array (bulk create)
  const isArray = Array.isArray(req.body);
  const holidays = isArray ? req.body : [req.body];
  const errors = [];

  const validTypes = ['National', 'Festival', 'Regional', 'Religious'];
  const validCategories = ['Mandatory', 'Restricted'];

  holidays.forEach((h, idx) => {
    const prefix = isArray ? `Row ${idx + 1}: ` : '';

    // ----- Required fields -----
    if (!h.name || !h.name.trim()) {
      errors.push(`${prefix}Name is required`);
    }

    if (!h.date) {
      errors.push(`${prefix}Date is required`);
    } else {
      const parsedDate = new Date(h.date);
      if (isNaN(parsedDate.getTime())) {
        errors.push(`${prefix}Invalid date format`);
      } else {
        // ✅ Normalize date in-place
        h.date = parsedDate;
      }
    }

    // ----- Type enum -----
    if (h.type && !validTypes.includes(h.type)) {
      errors.push(
        `${prefix}Type must be one of: ${validTypes.join(', ')}`
      );
    }

    // ----- ✅ Category enum -----
    if (h.category && !validCategories.includes(h.category)) {
      errors.push(
        `${prefix}Category must be one of: ${validCategories.join(', ')}`
      );
    }

    // ----- ✅ maxAllowed rules -----
    // Only valid for Restricted holidays; must be a positive integer
    const effectiveCategory = h.category || 'Mandatory';

    if (effectiveCategory === 'Restricted') {
      if (h.maxAllowed !== undefined && h.maxAllowed !== null) {
        if (!Number.isInteger(h.maxAllowed) || h.maxAllowed < 1) {
          errors.push(
            `${prefix}maxAllowed must be a positive integer for Restricted holidays`
          );
        }
      }
    } else {
      // Mandatory → maxAllowed must NOT be provided
      if (h.maxAllowed !== undefined && h.maxAllowed !== null) {
        errors.push(
          `${prefix}maxAllowed is only applicable for Restricted holidays`
        );
      }
    }

    // ----- ✅ applicableTo (must be array of strings) -----
    if (h.applicableTo !== undefined) {
      if (
        !Array.isArray(h.applicableTo) ||
        !h.applicableTo.every((v) => typeof v === 'string' && v.trim())
      ) {
        errors.push(
          `${prefix}applicableTo must be a non-empty array of strings`
        );
      }
    }
  });

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Holiday validation failed',
      errors,
    });
  }

  next();
};

module.exports = validateHolidayInput;