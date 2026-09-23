// controllers/comboOffController.js
const moment = require("moment-timezone");
const ComboOff = require("../models/ComboOff");
const User = require("../models/User");
const Holiday = require("../models/Holiday");

// Helper: Check if date is valid for Combo Off (weekend or holiday)
const isValidComboOffDate = async (date, user) => {
  const mDate = moment.tz(date, "Asia/Kolkata").startOf("day");
  const day = mDate.day(); // 0 = Sunday, 6 = Saturday

  const weekendType = user.weekendType || "sunday";

  const isWeekend =
    (weekendType === "sunday" && day === 0) ||
    (weekendType === "saturday_sunday" && (day === 0 || day === 6));

  // Check holiday
  const holiday = await Holiday.findOne({
    date: { $gte: mDate.toDate(), $lte: mDate.endOf("day").toDate() },
    isActive: true,
  });

  return isWeekend || !!holiday;
};

// Step 1 — Employee applies for Combo Off
exports.applyComboOff = async (req, res) => {
  try {
    const employeeId = req.user.id;
    const { workDate, reason } = req.body;

    if (!workDate || !reason) {
      return res.status(400).json({
        success: false,
        message: "Work date and reason are required",
      });
    }

    const date = moment.tz(workDate, "Asia/Kolkata").startOf("day").toDate();

    const user = await User.findById(employeeId).select("weekendType");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const isValid = await isValidComboOffDate(date, user);
    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: "Combo Off can only be applied for weekends or holidays.",
      });
    }

    const existing = await ComboOff.findOne({
      employee: employeeId,
      workDate: date,
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: "You have already applied for this date.",
      });
    }

    const comboOff = await ComboOff.create({
      employee: employeeId,
      workDate: date,
      reason,
      status: "pending",
    });

    res.status(201).json({
      success: true,
      message: "Combo Off application submitted successfully.",
      comboOff,
    });
  } catch (error) {
    console.error("🔥 Error applying for Combo Off:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Step 2 — HR approves or rejects Combo Off
exports.reviewComboOff = async (req, res) => {
  try {
    const { comboOffId } = req.params;
    const { action } = req.body; // 'approve' or 'reject'

    const comboOff = await ComboOff.findById(comboOffId);
    if (!comboOff) {
      return res.status(404).json({ success: false, message: "Combo Off not found" });
    }

    if (comboOff.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: "This request has already been processed",
      });
    }

    if (!["approve", "reject"].includes(action)) {
      return res.status(400).json({ success: false, message: "Invalid action" });
    }

    if (action === "approve") {
      comboOff.status = "approved";
      comboOff.approvedBy = req.user.id;
      comboOff.isCredited = true;

      await User.findByIdAndUpdate(
        comboOff.employee,
        { $inc: { "leaveBalance.combo": 1 } }
      );
    } else {
      comboOff.status = "rejected";
      comboOff.approvedBy = req.user.id;
    }

    await comboOff.save();

    res.status(200).json({
      success: true,
      message: `Combo Off ${comboOff.status} successfully`,
      comboOff,
    });
  } catch (error) {
    console.error("🔥 Error reviewing Combo Off:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Step 3 — Get all combo offs (HR/Admin)
exports.getAllComboOffs = async (req, res) => {
  try {
    const { status } = req.query;
    const query = status ? { status } : {};

    const comboOffs = await ComboOff.find(query)
      .populate("employee", "firstName lastName email employeeId")
      .populate("approvedBy", "firstName lastName email")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: comboOffs.length,
      comboOffs,
    });
  } catch (error) {
    console.error("🔥 Error fetching combo offs:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Step 4 — Get my combo offs (Employee)
exports.getMyComboOffs = async (req, res) => {
  try {
    const comboOffs = await ComboOff.find({ employee: req.user.id }).sort({
      createdAt: -1,
    });

    res.status(200).json({
      success: true,
      comboOffs,
    });
  } catch (error) {
    console.error("🔥 Error fetching user combo offs:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Step 5 — Get single combo off by ID
exports.getComboOffById = async (req, res) => {
  try {
    const comboOff = await ComboOff.findById(req.params.id)
      .populate("employee", "firstName lastName email")
      .populate("approvedBy", "firstName lastName email");

    if (!comboOff) {
      return res.status(404).json({ success: false, message: "Combo Off not found" });
    }

    res.status(200).json({ success: true, comboOff });
  } catch (error) {
    console.error("🔥 Error fetching combo off by ID:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Step 6 — Delete combo off (Employee only, pending status)
exports.deleteComboOff = async (req, res) => {
  try {
    const comboOff = await ComboOff.findById(req.params.id);

    if (!comboOff) {
      return res.status(404).json({ success: false, message: "Combo Off not found" });
    }

    if (comboOff.employee.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to delete this request",
      });
    }

    if (comboOff.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: "Cannot delete processed requests",
      });
    }

    await comboOff.deleteOne();

    res.status(200).json({
      success: true,
      message: "Combo Off request deleted successfully",
    });
  } catch (error) {
    console.error("🔥 Error deleting combo off:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Step 7 — Monthly Combo Off Summary (HR/Admin)
exports.getMonthlyComboOffSummary = async (req, res) => {
  try {
    const { month, year } = req.query;

    if (!month || !year) {
      return res.status(400).json({
        success: false,
        message: "Month and year are required",
      });
    }

    const monthNumber = Number(month);
    const yearNumber = Number(year);

    if (
      !Number.isInteger(monthNumber) ||
      monthNumber < 1 ||
      monthNumber > 12
    ) {
      return res.status(400).json({
        success: false,
        message: "Month must be between 1 and 12",
      });
    }

    if (
      !Number.isInteger(yearNumber) ||
      yearNumber < 2000 ||
      yearNumber > 2100
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid year",
      });
    }

    const formattedMonth = String(monthNumber).padStart(2, "0");

    const startDate = moment.tz(
      `${yearNumber}-${formattedMonth}-01`,
      "YYYY-MM-DD",
      true
    );

    if (!startDate.isValid()) {
      return res.status(400).json({
        success: false,
        message: "Invalid month/year",
      });
    }

    const endDate = startDate.clone().endOf("month");

    const summary = await ComboOff.aggregate([
      {
        $match: {
          status: "approved",
          workDate: {
            $gte: startDate.toDate(),
            $lte: endDate.toDate(),
          },
        },
      },
      {
        $group: {
          _id: "$employee",
          totalApproved: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "employee",
        },
      },
      {
        $unwind: "$employee",
      },
      {
        $project: {
          _id: 0,
          employeeId: "$employee._id",
          name: {
            $concat: [
              "$employee.firstName",
              " ",
              "$employee.lastName",
            ],
          },
          email: "$employee.email",
          totalApproved: 1,
        },
      },
      {
        $sort: {
          name: 1,
        },
      },
    ]);

    return res.status(200).json({
      success: true,
      month: monthNumber,
      year: yearNumber,
      totalEmployees: summary.length,
      summary,
    });
  } catch (error) {
    console.error("🔥 Error fetching monthly summary:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

exports.getComboOffBalance = async (req, res) => {
  try {
    const employeeId = req.user.id;
    
    const user = await User.findById(employeeId).select("leaveBalance");
    
    const currentYear = moment().year();
    const yearStart = moment(`${currentYear}-01-01`).toDate();
    const yearEnd = moment(`${currentYear}-12-31`).toDate();
    
    const usedThisYear = await ComboOff.countDocuments({
      employee: employeeId,
      status: "approved",
      workDate: { $gte: yearStart, $lte: yearEnd }
    });
    
    const pendingCount = await ComboOff.countDocuments({
      employee: employeeId,
      status: "pending"
    });
    
    res.status(200).json({
      success: true,
      balance: {
        available: user.leaveBalance?.combo || 0,
        usedThisYear,
        pending: pendingCount,
        remaining: (user.leaveBalance?.combo || 0) - usedThisYear
      }
    });
  } catch (error) {
    console.error("🔥 Error fetching balance:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};