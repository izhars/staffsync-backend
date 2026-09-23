const Attendance = require('../models/Attendance');
const User = require('../models/User');
const Holiday = require('../models/Holiday');
const Leave = require('../models/Leave');
const ComboOff = require('../models/ComboOff');
const moment = require('moment-timezone');
const RestrictedHolidayUsage = require('../models/RestrictedHolidayUsage');
const { isWithinAnyGeoFence } = require('../utils/geoFence');
const { ACCESS_ROLES, NON_ADMIN_ROLES, } = require('../constants/roles');
const {
  evaluatePunchVerification,
  PRIVILEGED_ROLES,
} = require('../utils/punchVerification');
const FaceEmbedding = require('../models/FaceEmbedding');
const { verifyEmployeeFace } = require('../utils/faceMatch');
const FACE_MATCH_THRESHOLD = 0.75;

const {
  getISTDate,
  getISTMidnight,
  getISTStandardTime,
  getISTStandardCheckoutTime,
  formatISTTime,
  getCurrentWorkHours,
  getISTDay,
} = require('../utils/dateUtils');

exports.checkIn = async (req, res) => {
  try {
    const { latitude, longitude, address, deviceInfo, faceEmbedding } = req.body;
    const today = getISTMidnight();

    // ── 0. Fetch user with role + weekend + department ────────────────
    const user = await User.findById(req.user.id).select(
      'weekendType department role'
    );
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const hasCoords =
      latitude !== undefined &&
      longitude !== undefined &&
      !isNaN(parseFloat(latitude)) &&
      !isNaN(parseFloat(longitude));

    // ── 1. Verification gate (role + network) ─────────────────────────
    const verification = evaluatePunchVerification({ req, user, hasCoords });

    if (!verification.allowed) {
      const msg =
        verification.reason === 'NO_LOCATION'
          ? 'Location coordinates are required for check-in'
          : verification.reason === 'NOT_ON_OFFICE_NETWORK'
            ? 'Desktop punch requires office network. Use mobile with GPS or connect to office Wi-Fi.'
            : 'Check-in not allowed';
      return res.status(403).json({
        success: false,
        reason: verification.reason,
        message: msg,
      });
    }

    // ── 1b. Face verification (mobile, non-privileged employees) ──────
    const requiresFace =
      verification.punchedFrom === 'mobile' && !PRIVILEGED_ROLES.includes(user.role);

    let faceResult = null;
    if (requiresFace) {
      faceResult = await verifyEmployeeFace(
        FaceEmbedding,
        req.user.id,
        faceEmbedding,
        FACE_MATCH_THRESHOLD
      );
      if (!faceResult.ok) {
        return res.status(faceResult.status).json({
          success: false,
          reason: faceResult.reason,
          message: faceResult.message,
          ...(faceResult.similarity !== undefined && { similarity: faceResult.similarity }),
        });
      }
    }

    // ── 2. Geo-fence (only if GPS present) ────────────────────────────
    let geoCheck = {
      allowed: true,
      reason: 'SKIPPED_NO_GPS',
      matchedLocation: null,
    };

    if (hasCoords) {
      geoCheck = await isWithinAnyGeoFence(
        parseFloat(latitude),
        parseFloat(longitude),
        req.user.id,
        user?.department
      );

      if (!geoCheck.allowed && PRIVILEGED_ROLES.includes(user.role)) {
        console.warn(
          `[GEO-FENCE] ⚠️ HR/Admin outside fence (${geoCheck.reason}). Allowing with bypass tag.`
        );
        verification.method = 'BYPASS_PRIVILEGED';
        verification.bypass = true;
        verification.reason = `HR/Admin outside fence: ${geoCheck.reason}`;
      } else if (!geoCheck.allowed) {
        return res.status(403).json({
          success: false,
          reason: geoCheck.reason,
          message: geoCheck.message,
          nearestLocation: geoCheck.nearestLocation,
          allLocations: geoCheck.allLocations,
          yourLocation: { latitude, longitude },
        });
      }
    }

    // ── 3. Weekend / Holiday check ────────────────────────────────────
    const weekendType = user.weekendType || 'sunday';
    const day = getISTDay(today);
    const isWeekend =
      (weekendType === 'sunday' && day === 0) ||
      (weekendType === 'saturday_sunday' && (day === 0 || day === 6));

    const startOfDay = getISTMidnight();
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(startOfDay.getDate() + 1);

    const holiday = await Holiday.findOne({
      date: { $gte: startOfDay, $lt: endOfDay },
      isActive: true,
    });

    let comboOff = null;
    let isRestrictedHoliday = false;
    let restrictedHolidayQuota = null;

    if (isWeekend && !holiday) {
      // ── Plain weekend (no holiday) ──
      comboOff = await ComboOff.findOne({
        employee: req.user.id,
        date: today,
        status: 'approved',
      });

      if (!comboOff) {
        return res.status(400).json({
          success: false,
          message: 'Cannot check in on your weekly off day without approved Combo Off',
        });
      }
    } else if (holiday) {
      // ── Holiday present ──
      if (holiday.category === 'Mandatory') {
        // Mandatory holiday → block unless Combo Off approved
        comboOff = await ComboOff.findOne({
          employee: req.user.id,
          date: today,
          status: 'approved',
        });

        if (!comboOff) {
          return res.status(400).json({
            success: false,
            message: `Cannot check in on Mandatory holiday (${holiday.name}) without approved Combo Off`,
          });
        }
      } else if (holiday.category === 'Restricted') {
        isRestrictedHoliday = true;

        const currentYear = new Date(today).getFullYear();

        // Quota: use maxAllowed from holiday if set, else default 2
        const quota =
          holiday.maxAllowed && holiday.maxAllowed > 0
            ? holiday.maxAllowed
            : 2;
        restrictedHolidayQuota = quota;

        // Check if user already availed THIS holiday
        const existingUsageForThisHoliday =
          await RestrictedHolidayUsage.findOne({
            employee: req.user.id,
            holiday: holiday._id,
          });

        if (existingUsageForThisHoliday) {
          return res.status(400).json({
            success: false,
            message: `You have already availed the restricted holiday: ${holiday.name}`,
          });
        }

        // Count how many restricted holidays availed this year
        const usedCount = await RestrictedHolidayUsage.countDocuments({
          employee: req.user.id,
          year: currentYear,
        });

        if (usedCount >= quota) {
          return res.status(400).json({
            success: false,
            message: `You have exhausted your restricted holiday quota for ${currentYear} (${usedCount}/${quota} used)`,
          });
        }

        // Check applicability
        if (
          holiday.applicableTo &&
          !holiday.applicableTo.includes('all') &&
          !holiday.applicableTo.includes(user.role)
        ) {
          return res.status(403).json({
            success: false,
            message: `You are not eligible for this restricted holiday`,
          });
        }

        // ✅ No Combo Off required for restricted holidays
      }
    }

    // ── 4. Leave check ────────────────────────────────────────────────
    const leave = await Leave.findOne({
      employee: req.user.id,
      fromDate: { $lte: today },
      toDate: { $gte: today },
      status: 'approved',
    });

    if (leave) {
      return res.status(400).json({
        success: false,
        message: 'Cannot check in, you are on approved leave',
      });
    }

    // ── 5. Time restriction ───────────────────────────────────────────
    const currentIST = moment().tz('Asia/Kolkata');
    if (currentIST.hour() >= 18) {
      return res.status(400).json({
        success: false,
        message: 'Check-in not allowed after 6 PM. Office closed bro 🛑',
      });
    }

    // ── 6. Already checked in? ────────────────────────────────────────
    const existingAttendance = await Attendance.findOne({
      employee: req.user.id,
      date: today,
    });

    if (existingAttendance?.checkIn?.time) {
      return res.status(400).json({
        success: false,
        message: 'Already checked in today',
        checkInTime: formatISTTime(existingAttendance.checkIn.time),
      });
    }

    // ── 7. Record check-in ────────────────────────────────────────────
    const checkInTime = getISTDate();
    const standardTime = getISTStandardTime();
    const isLate = checkInTime > standardTime;
    const lateBy = isLate
      ? Math.round((checkInTime - standardTime) / (1000 * 60))
      : 0;

    const punchPayload = {
      time: checkInTime,
      location: hasCoords
        ? {
          latitude,
          longitude,
          address,
          matchedLocationName: geoCheck.matchedLocation?.name,
          distanceFromOffice: geoCheck.matchedLocation?.distance,
        }
        : {
          address: address || 'Desktop / No GPS',
        },
      deviceInfo,
      punchedFrom: verification.punchedFrom,
      verificationMethod: requiresFace
        ? (hasCoords ? 'FACE_GPS' : 'FACE_ONLY')
        : verification.method,
      isGpsBypassed: verification.bypass,
      bypassReason: verification.reason,
      clientIp: verification.clientIp,
      faceVerified: !!faceResult?.ok,
      faceSimilarity: faceResult?.similarity ?? null,
      faceThreshold: faceResult?.threshold ?? null,
      faceModel: faceResult?.model ?? null,
      faceLivenessPassed: requiresFace,
    };

    let attendance;
    if (existingAttendance) {
      existingAttendance.checkIn = punchPayload;
      existingAttendance.status = 'present';
      existingAttendance.isLate = isLate;
      existingAttendance.lateBy = lateBy;
      attendance = await existingAttendance.save();
    } else {
      attendance = await Attendance.create({
        employee: req.user.id,
        date: today,
        checkIn: punchPayload,
        status: 'present',
        isLate,
        lateBy,
      });
    }

    // ── 8. Mark Combo Off as earned (only for weekend/mandatory holidays) ──
    if (comboOff) {
      comboOff.status = 'earned';
      comboOff.earnedOn = new Date();
      await comboOff.save();
    }

    // ── 8b. Record restricted holiday usage ───────────────────────────
    if (isRestrictedHoliday && holiday) {
      try {
        await RestrictedHolidayUsage.create({
          employee: req.user.id,
          holiday: holiday._id,
          date: today,
          year: new Date(today).getFullYear(),
          action: 'punched_in',
        });
      } catch (err) {
        // Duplicate key → already recorded; ignore
        if (err.code !== 11000) {
          console.error('Failed to record restricted holiday usage:', err);
        }
      }
    }

    // ── 9. Response ───────────────────────────────────────────────────
    const responseExtras = {};
    if (isRestrictedHoliday && holiday) {
      const usedCount = await RestrictedHolidayUsage.countDocuments({
        employee: req.user.id,
        year: new Date(today).getFullYear(),
      });
      responseExtras.restrictedHoliday = {
        holidayName: holiday.name,
        used: usedCount,
        quota: restrictedHolidayQuota,
        remaining: Math.max(0, restrictedHolidayQuota - usedCount),
      };
    }

    res.status(200).json({
      success: true,
      message: isLate
        ? `Checked in ${lateBy} minutes late`
        : 'Checked in successfully',
      checkInTime: formatISTTime(checkInTime),
      isLate,
      lateBy,
      verification: {
        method: verification.method,
        bypassed: verification.bypass,
        punchedFrom: verification.punchedFrom,
      },
      face: requiresFace
        ? { verified: true, similarity: faceResult.similarity, threshold: faceResult.threshold }
        : { verified: false },
      ...responseExtras,
      attendance: {
        ...attendance.toObject(),
        checkInTimeFormatted: formatISTTime(attendance.checkIn.time),
      },
    });
  } catch (error) {
    console.error('Check-in error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.checkOut = async (req, res) => {
  try {
    const { latitude, longitude, address, deviceInfo, faceEmbedding } = req.body;

    // ── 0. Fetch user ─────────────────────────────────────────────────
    const user = await User.findById(req.user.id).select('department role');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const hasCoords =
      latitude !== undefined &&
      longitude !== undefined &&
      !isNaN(parseFloat(latitude)) &&
      !isNaN(parseFloat(longitude));

    // ── 1. Verification gate ──────────────────────────────────────────
    const verification = evaluatePunchVerification({ req, user, hasCoords });

    if (!verification.allowed) {
      const msg =
        verification.reason === 'NO_LOCATION'
          ? 'Location coordinates are required for check-out'
          : verification.reason === 'NOT_ON_OFFICE_NETWORK'
            ? 'Desktop punch requires office network. Use mobile with GPS or connect to office Wi-Fi.'
            : 'Check-out not allowed';
      return res.status(403).json({
        success: false,
        reason: verification.reason,
        message: msg,
      });
    }

    // ── 1b. Face verification (mobile, non-privileged employees) ──────
    const requiresFace =
      verification.punchedFrom === 'mobile' && !PRIVILEGED_ROLES.includes(user.role);

    let faceResult = null;
    if (requiresFace) {
      faceResult = await verifyEmployeeFace(
        FaceEmbedding,
        req.user.id,
        faceEmbedding,
        FACE_MATCH_THRESHOLD
      );
      if (!faceResult.ok) {
        return res.status(faceResult.status).json({
          success: false,
          reason: faceResult.reason,
          message: faceResult.message,
          ...(faceResult.similarity !== undefined && { similarity: faceResult.similarity }),
        });
      }
    }

    // ── 2. Geo-fence (only if GPS) ────────────────────────────────────
    let geoCheck = {
      allowed: true,
      reason: 'SKIPPED_NO_GPS',
      matchedLocation: null,
    };

    if (hasCoords) {
      geoCheck = await isWithinAnyGeoFence(
        parseFloat(latitude),
        parseFloat(longitude),
        req.user.id,
        user?.department
      );

      if (!geoCheck.allowed && PRIVILEGED_ROLES.includes(user.role)) {
        console.warn(
          `[GEO-FENCE][CHECKOUT] ⚠️ HR/Admin outside fence. Allowing with bypass tag.`
        );
        verification.method = 'BYPASS_PRIVILEGED';
        verification.bypass = true;
        verification.reason = `HR/Admin outside fence: ${geoCheck.reason}`;
      } else if (!geoCheck.allowed) {
        return res.status(403).json({
          success: false,
          reason: geoCheck.reason,
          message: geoCheck.message,
          nearestLocation: geoCheck.nearestLocation,
          allLocations: geoCheck.allLocations,
          yourLocation: { latitude, longitude },
        });
      }
    }

    // ── 3. Load attendance ────────────────────────────────────────────
    const today = getISTMidnight();
    const attendance = await Attendance.findOne({
      employee: req.user.id,
      date: today,
    });

    if (!attendance || !attendance.checkIn?.time) {
      return res
        .status(400)
        .json({ success: false, message: 'Please check in first' });
    }

    if (attendance.checkOut?.time) {
      return res
        .status(400)
        .json({ success: false, message: 'Already checked out today' });
    }

    let checkOutTime = getISTDate();
    const checkInIST = moment(attendance.checkIn.time).tz('Asia/Kolkata');
    const checkOutIST = moment(checkOutTime).tz('Asia/Kolkata');

    if (checkOutIST.isBefore(checkInIST)) {
      return res.status(400).json({
        success: false,
        message: 'Check-out time cannot be before check-in time',
      });
    }

    // Cap at end of day IST
    const endOfDayIST = moment.tz(today, 'Asia/Kolkata').endOf('day');
    const missedCheckout = checkOutIST.isAfter(endOfDayIST);
    if (missedCheckout) {
      checkOutTime = endOfDayIST.toDate();
    }

    // ── 4. Short attendance ───────────────────────────────────────────
    const standardCheckOutIST = moment(getISTStandardCheckoutTime()).tz(
      'Asia/Kolkata'
    );
    const finalCheckoutIST = moment(checkOutTime).tz('Asia/Kolkata');
    const isShort = finalCheckoutIST.isBefore(standardCheckOutIST);
    const shortByMinutes = isShort
      ? standardCheckOutIST.diff(finalCheckoutIST, 'minutes')
      : 0;

    // ── 5. Record checkout ────────────────────────────────────────────
    attendance.checkOut = {
      time: checkOutTime,
      location: hasCoords
        ? {
          latitude,
          longitude,
          address,
          matchedLocationName: geoCheck.matchedLocation?.name,
          distanceFromOffice: geoCheck.matchedLocation?.distance,
        }
        : {
          address: address || 'Desktop / No GPS',
        },
      deviceInfo,
      punchedFrom: verification.punchedFrom,
      verificationMethod: requiresFace
        ? (hasCoords ? 'FACE_GPS' : 'FACE_ONLY')
        : verification.method,
      isGpsBypassed: verification.bypass,
      bypassReason: verification.reason,
      clientIp: verification.clientIp,
      faceVerified: !!faceResult?.ok,
      faceSimilarity: faceResult?.similarity ?? null,
      faceThreshold: faceResult?.threshold ?? null,
      faceModel: faceResult?.model ?? null,
      faceLivenessPassed: requiresFace,
    };

    const workHours = parseFloat(
      finalCheckoutIST.diff(checkInIST, 'minutes') / 60
    ).toFixed(2);

    attendance.workHours = parseFloat(workHours);
    attendance.isShortAttendance = isShort;
    attendance.shortByMinutes = shortByMinutes;
    if (missedCheckout) attendance.missedCheckout = true;

    await attendance.save();

    // ── 6. Restricted holiday context (informational only) ────────────
    let restrictedHolidayInfo = null;
    try {
      const holiday = await Holiday.findOne({
        date: { $gte: today, $lt: new Date(today.getTime() + 86400000) },
        isActive: true,
        category: 'Restricted',
      });

      if (holiday) {
        const currentYear = new Date(today).getFullYear();
        const quota =
          holiday.maxAllowed && holiday.maxAllowed > 0
            ? holiday.maxAllowed
            : 2;

        const usedCount = await RestrictedHolidayUsage.countDocuments({
          employee: req.user.id,
          year: currentYear,
        });

        restrictedHolidayInfo = {
          holidayName: holiday.name,
          used: usedCount,
          quota,
          remaining: Math.max(0, quota - usedCount),
        };
      }
    } catch (err) {
      console.error('Failed to fetch restricted holiday info:', err);
    }

    res.status(200).json({
      success: true,
      message: missedCheckout
        ? `Checked out at 23:59 (auto). Work hours: ${workHours}`
        : isShort
          ? `Checked out – short by ${shortByMinutes} min. Work hours: ${workHours}`
          : `Checked out – full day. Work hours: ${workHours}`,
      checkOutTime: formatISTTime(checkOutTime),
      workHours,
      isShortAttendance: isShort,
      shortByMinutes,
      missedCheckout,
      verification: {
        method: verification.method,
        bypassed: verification.bypass,
        punchedFrom: verification.punchedFrom,
      },
      face: requiresFace
        ? { verified: true, similarity: faceResult.similarity, threshold: faceResult.threshold }
        : { verified: false },
      location: {
        matchedLocation: geoCheck.matchedLocation,
        distance: geoCheck.matchedLocation?.distance,
      },
      ...(restrictedHolidayInfo && { restrictedHoliday: restrictedHolidayInfo }),
      attendance: {
        ...attendance.toObject(),
        checkInTimeFormatted: formatISTTime(attendance.checkIn.time),
        checkOutTimeFormatted: formatISTTime(checkOutTime),
      },
    });
  } catch (error) {
    console.error('Check-out error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Mark missed checkouts
// @access  Internal (e.g., cron job)
exports.markMissedCheckouts = async () => {
  const today = getISTMidnight();
  const endOfDay = new Date(today);
  endOfDay.setHours(23, 59, 59, 999);

  const forgotCheckouts = await Attendance.find({
    date: today,
    checkIn: { $exists: true },
    checkOut: { $exists: false },
  });

  for (const attendance of forgotCheckouts) {
    const workHours = ((endOfDay - attendance.checkIn.time) / (1000 * 60 * 60)).toFixed(2);
    attendance.checkOut = { time: endOfDay };
    attendance.workHours = parseFloat(workHours);
    attendance.missedCheckout = true;
    await attendance.save();
  }
};

// Helper (put near top of file, after imports)
function computeWorkHours(checkInTime, checkOutTime) {
  if (!checkInTime || !checkOutTime) return 0;
  const diffMs = new Date(checkOutTime) - new Date(checkInTime);
  return Number((diffMs / (1000 * 60 * 60)).toFixed(2));
}

// @desc    Get my attendance
// @route   GET /api/attendance/my-attendance
// @access  Private
exports.getMyAttendance = async (req, res) => {
  try {
    const { startDate, endDate, month, year } = req.query;

    const employeeId = req.user.id;

    const user = await User.findById(employeeId).select(
      'weekendType dateOfJoining createdAt'
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found',
      });
    }

    const weekendType = user.weekendType || 'sunday';

    // ── Same DOJ-safe logic as HR version ─────────────────────────────
    const dojFromProfile = user.dateOfJoining
      ? moment(user.dateOfJoining).tz('Asia/Kolkata').startOf('day')
      : null;

    const firstRealPunch = await Attendance.findOne({
      employee: employeeId,
      'checkIn.time': { $ne: null },
    })
      .sort({ date: 1 })
      .select('date')
      .lean();

    const firstPunchMoment = firstRealPunch
      ? moment(firstRealPunch.date).tz('Asia/Kolkata').startOf('day')
      : null;

    let doj;
    if (dojFromProfile && firstPunchMoment) {
      doj = moment.max(dojFromProfile, firstPunchMoment);
    } else if (dojFromProfile) {
      doj = dojFromProfile;
    } else if (firstPunchMoment) {
      doj = firstPunchMoment;
    } else {
      doj = moment.tz('Asia/Kolkata').startOf('day');
    }

    let start, end;

    if (startDate && endDate) {
      start = moment.tz(startDate, 'Asia/Kolkata').startOf('day');
      end = moment.tz(endDate, 'Asia/Kolkata').endOf('day');
    } else if (month && year) {
      start = moment
        .tz({ year: +year, month: +month - 1, day: 1 }, 'Asia/Kolkata')
        .startOf('day');
      end = moment(start).endOf('month');
    } else {
      start = moment.tz('Asia/Kolkata').startOf('month');
      end = moment(start).endOf('month');
    }

    start = moment.max(start, doj);

    if (start.isAfter(end, 'day')) {
      return res.status(200).json({
        success: true,
        count: 0,
        stats: {
          totalDays: 0,
          present: 0,
          absent: 0,
          halfDay: 0,
          onLeave: 0,
          holiday: 0,
          weeklyOff: 0,
          comboOff: 0,
          totalWorkHours: 0,
          lateCount: 0,
          workedOnHoliday: 0,
          workedOnWeeklyOff: 0,
          missedCheckouts: 0,
        },
        attendance: [],
      });
    }

    const startUTC = start.clone().utc().toDate();
    const endUTC = end.clone().utc().toDate();

    const [attendance, holidays, comboOffs, leaves] = await Promise.all([
      Attendance.find({
        employee: employeeId,
        date: { $gte: startUTC, $lte: endUTC },
      })
        .sort({ date: -1 })
        .lean(),

      Holiday.find({
        date: { $gte: startUTC, $lte: endUTC },
        isActive: true,
      }).lean(),

      ComboOff.find({
        employee: employeeId,
        date: { $gte: startUTC, $lte: endUTC },
        status: { $in: ['approved', 'used', 'earned'] },
      }).lean(),

      Leave.find({
        employee: employeeId,
        fromDate: { $lte: endUTC },
        toDate: { $gte: startUTC },
        status: 'approved',
      }).lean(),
    ]);

    const holidayMap = new Map(
      holidays.map((h) => [
        moment(h.date).tz('Asia/Kolkata').format('YYYY-MM-DD'),
        { name: h.name, type: h.type, category: h.category },
      ])
    );

    const attendanceMap = new Map(
      attendance.map((a) => [
        moment(a.date).tz('Asia/Kolkata').format('YYYY-MM-DD'),
        a,
      ])
    );

    const comboOffMap = new Map(
      comboOffs.map((c) => [
        moment(c.date).tz('Asia/Kolkata').format('YYYY-MM-DD'),
        c,
      ])
    );

    const leaveMap = new Map();
    leaves.forEach((l) => {
      let d = moment(l.fromDate).tz('Asia/Kolkata').startOf('day');
      const last = moment(l.toDate).tz('Asia/Kolkata').startOf('day');
      while (d.isSameOrBefore(last, 'day')) {
        leaveMap.set(d.format('YYYY-MM-DD'), l);
        d.add(1, 'day');
      }
    });

    const today = moment.tz('Asia/Kolkata').startOf('day');
    const totalDays = [];
    let current = start.clone();

    while (
      current.isSameOrBefore(end, 'day') &&
      current.isSameOrBefore(today, 'day')
    ) {
      if (current.isBefore(doj, 'day')) {
        current.add(1, 'day');
        continue;
      }

      const dateKey = current.format('YYYY-MM-DD');
      const day = getISTDay(current);

      const record = attendanceMap.get(dateKey);
      const holiday = holidayMap.get(dateKey);
      const comboOff = comboOffMap.get(dateKey);
      const leave = leaveMap.get(dateKey);

      let isWeekend = false;
      if (weekendType === 'sunday') {
        isWeekend = day === 0;
      } else if (weekendType === 'saturday_sunday') {
        isWeekend = day === 0 || day === 6;
      }

      const hasRealPunch = !!(record && record.checkIn?.time);

      if (comboOff) {
        totalDays.push({
          date: dateKey,
          status: 'combo-off',
          comboOffStatus: comboOff.status,
          remarks: comboOff.remarks || null,
          approvedBy: comboOff.approvedBy || null,
          workHours: 0,
          checkIn: { time: null },
          checkOut: { time: null },
          isLate: false,
        });
      } else if (leave) {
        totalDays.push({
          date: dateKey,
          status: 'on-leave',
          leaveType: leave.type || leave.leaveType,
          workHours: 0,
          checkIn: { time: null },
          checkOut: { time: null },
          isLate: false,
        });
      } else if (hasRealPunch) {
        const isToday = current.isSame(today, 'day');

        let workHours = record.workHours || 0;
        if (isToday) {
          workHours = getCurrentWorkHours(record);
        } else if (record.checkIn?.time && record.checkOut?.time) {
          workHours = computeWorkHours(
            record.checkIn.time,
            record.checkOut.time
          );
        }

        const missedCheckout =
          !isToday && !!record.checkIn?.time && !record.checkOut?.time;

        const {
          _id,
          employee,
          createdAt,
          updatedAt,
          __v,
          ...cleanRecord
        } = record;

        totalDays.push({
          ...cleanRecord,
          date: dateKey,
          status: record.status || 'present',
          workHours,
          missedCheckout,
          holidayName: holiday?.name || null,
          holidayType: holiday?.type || null,
          isRestrictedHoliday: holiday?.category === 'Restricted',
          isWeeklyOffWork: isWeekend || false,
          checkInTimeFormatted: record.checkIn?.time
            ? formatISTTime(record.checkIn.time)
            : null,
          checkOutTimeFormatted: record.checkOut?.time
            ? formatISTTime(record.checkOut.time)
            : null,
        });
      } else if (holiday) {
        totalDays.push({
          date: dateKey,
          status: 'holiday',
          holidayName: holiday.name,
          holidayType: holiday.type,
          holidayCategory: holiday.category,
          workHours: 0,
          checkIn: { time: null },
          checkOut: { time: null },
          isLate: false,
        });
      } else if (isWeekend) {
        totalDays.push({
          date: dateKey,
          status: 'weekly-off',
          workHours: 0,
          checkIn: { time: null },
          checkOut: { time: null },
          isLate: false,
        });
      } else {
        totalDays.push({
          date: dateKey,
          status: 'absent',
          workHours: 0,
          checkIn: { time: null },
          checkOut: { time: null },
          isLate: false,
        });
      }

      current.add(1, 'day');
    }

    const stats = {
      totalDays: totalDays.length,
      present: totalDays.filter((a) => a.status === 'present').length,
      absent: totalDays.filter((a) => a.status === 'absent').length,
      halfDay: totalDays.filter((a) => a.status === 'half-day').length,
      onLeave: totalDays.filter((a) => a.status === 'on-leave').length,
      holiday: totalDays.filter((a) => a.status === 'holiday').length,
      weeklyOff: totalDays.filter((a) => a.status === 'weekly-off').length,
      comboOff: totalDays.filter((a) => a.status === 'combo-off').length,

      totalWorkHours: Number(
        totalDays.reduce((s, a) => s + (a.workHours || 0), 0).toFixed(2)
      ),
      lateCount: totalDays.filter((a) => a.isLate).length,

      workedOnHoliday: totalDays.filter(
        (a) => a.status === 'present' && a.holidayName
      ).length,
      workedOnWeeklyOff: totalDays.filter(
        (a) => a.status === 'present' && a.isWeeklyOffWork
      ).length,
      missedCheckouts: totalDays.filter((a) => a.missedCheckout).length,
    };

    res.status(200).json({
      success: true,
      count: totalDays.length,
      stats,
      attendance: totalDays,
    });
  } catch (error) {
    console.error('Attendance fetch error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};


exports.getEmployeeAttendancWithCalender = async (req, res) => {
  try {
    const { startDate, endDate, month, year } = req.query;

    const employeeId = req.params.employeeId || req.query.employeeId;

    if (!employeeId) {
      return res.status(400).json({
        success: false,
        message: 'employeeId is required',
      });
    }

    const user = await User.findById(employeeId).select(
      'name email employeeId department designation weekendType dateOfJoining createdAt'
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found',
      });
    }

    const weekendType = user.weekendType || 'sunday';
    const dojFromProfile = user.dateOfJoining
      ? moment(user.dateOfJoining).tz('Asia/Kolkata').startOf('day')
      : null;

    const firstRealPunch = await Attendance.findOne({
      employee: employeeId,
      'checkIn.time': { $ne: null },
    })
      .sort({ date: 1 })
      .select('date')
      .lean();

    const firstPunchMoment = firstRealPunch
      ? moment(firstRealPunch.date).tz('Asia/Kolkata').startOf('day')
      : null;

    let doj;
    if (dojFromProfile && firstPunchMoment) {
      doj = moment.max(dojFromProfile, firstPunchMoment);
    } else if (dojFromProfile) {
      doj = dojFromProfile;
    } else if (firstPunchMoment) {
      doj = firstPunchMoment;
    } else {
      doj = moment.tz('Asia/Kolkata').startOf('day');
    }

    let start, end;

    if (startDate && endDate) {
      start = moment.tz(startDate, 'Asia/Kolkata').startOf('day');
      end = moment.tz(endDate, 'Asia/Kolkata').endOf('day');
    } else if (month && year) {
      start = moment
        .tz({ year: +year, month: +month - 1, day: 1 }, 'Asia/Kolkata')
        .startOf('day');
      end = moment(start).endOf('month');
    } else {
      start = moment.tz('Asia/Kolkata').startOf('month');
      end = moment(start).endOf('month');
    }

    if (start.isAfter(end, 'day')) {
      return res.status(200).json({
        success: true,
        employee: {
          _id: user._id,
          name: user.name,
          email: user.email,
          employeeId: user.employeeId,
          department: user.department,
          designation: user.designation,
        },
        count: 0,
        stats: {
          totalDays: 0,
          present: 0,
          absent: 0,
          halfDay: 0,
          onLeave: 0,
          holiday: 0,
          weeklyOff: 0,
          comboOff: 0,
          totalWorkHours: 0,
          lateCount: 0,
          workedOnHoliday: 0,
          workedOnWeeklyOff: 0,
          missedCheckouts: 0,
        },
        attendance: [],
      });
    }

    const startUTC = start.clone().utc().toDate();
    const endUTC = end.clone().utc().toDate();

    const [attendance, holidays, comboOffs, leaves] = await Promise.all([
      Attendance.find({
        employee: employeeId,
        date: { $gte: startUTC, $lte: endUTC },
      })
        .sort({ date: -1 })
        .lean(),

      Holiday.find({
        date: { $gte: startUTC, $lte: endUTC },
        isActive: true,
      })
        .select('name date type category description maxAllowed image')
        .lean(),

      ComboOff.find({
        employee: employeeId,
        date: { $gte: startUTC, $lte: endUTC },
        status: { $in: ['approved', 'used', 'earned'] },
      }).lean(),

      Leave.find({
        employee: employeeId,
        fromDate: { $lte: endUTC },
        toDate: { $gte: startUTC },
        status: 'approved',
      }).lean(),
    ]);

    const holidayMap = new Map(
      holidays.map((h) => [
        moment(h.date).tz('Asia/Kolkata').format('YYYY-MM-DD'),
        {
          name: h.name,
          type: h.type,
          category: h.category,
          description: h.description,
          maxAllowed: h.maxAllowed,
          image: h.image,   // ← was missing
        },
      ])
    );

    const attendanceMap = new Map(
      attendance.map((a) => [
        moment(a.date).tz('Asia/Kolkata').format('YYYY-MM-DD'),
        a,
      ])
    );

    const comboOffMap = new Map(
      comboOffs.map((c) => [
        moment(c.date).tz('Asia/Kolkata').format('YYYY-MM-DD'),
        c,
      ])
    );

    const leaveMap = new Map();
    leaves.forEach((l) => {
      let d = moment(l.fromDate).tz('Asia/Kolkata').startOf('day');
      const last = moment(l.toDate).tz('Asia/Kolkata').startOf('day');
      while (d.isSameOrBefore(last, 'day')) {
        leaveMap.set(d.format('YYYY-MM-DD'), l);
        d.add(1, 'day');
      }
    });

    const today = moment.tz('Asia/Kolkata').startOf('day');
    const totalDays = [];
    let current = start.clone();

    while (
      current.isSameOrBefore(end, 'day') &&
      current.isSameOrBefore(today, 'day')
    ) {
      const dateKey = current.format('YYYY-MM-DD');
      const day = getISTDay(current);

      const record = attendanceMap.get(dateKey);
      const holiday = holidayMap.get(dateKey);
      const comboOff = comboOffMap.get(dateKey);
      const leave = leaveMap.get(dateKey);

      const isPreDoj = current.isBefore(doj, 'day');

      // Skip days before DOJ, EXCEPT holidays (so pre-DOJ holidays are visible)
      if (isPreDoj && !holiday) {
        current.add(1, 'day');
        continue;
      }

      if (holiday) {
        const hasRealPunch = !!(record && record.checkIn?.time);
        const workedOnHoliday = hasRealPunch;

        totalDays.push({
          date: dateKey,
          status: 'holiday',
          isPreDoj,
          holidayName: holiday.name,
          holidayType: holiday.type,
          holidayCategory: holiday.category,
          holidayDescription: holiday.description || null,
          holidayMaxAllowed: holiday.maxAllowed ?? null,
          holidayImage: holiday.image || null,             // ✅ full image object
          holidayImageUrl: holiday.image?.url || null,     // ✅ convenient flat URL
          holidayImageThumbnail: holiday.image?.url
            ? holiday.image.url.replace(
              '/upload/',
              '/upload/w_200,h_200,c_fill,q_auto,f_auto/'
            )
            : null,
          workHours: hasRealPunch ? record.workHours || 0 : 0,
          checkIn: { time: record?.checkIn?.time || null },
          checkOut: { time: record?.checkOut?.time || null },
          isLate: record?.isLate || false,
          workedOnHoliday,
          checkInTimeFormatted: record?.checkIn?.time
            ? formatISTTime(record.checkIn.time)
            : null,
          checkOutTimeFormatted: record?.checkOut?.time
            ? formatISTTime(record.checkOut.time)
            : null,
        });

        current.add(1, 'day');
        continue;
      }

      let isWeekend = false;
      if (weekendType === 'sunday') {
        isWeekend = day === 0;
      } else if (weekendType === 'saturday_sunday') {
        isWeekend = day === 0 || day === 6;
      }

      const hasRealPunch = !!(record && record.checkIn?.time);

      if (comboOff) {
        totalDays.push({
          date: dateKey,
          status: 'combo-off',
          comboOffStatus: comboOff.status,
          remarks: comboOff.remarks || null,
          approvedBy: comboOff.approvedBy || null,
          workHours: 0,
          checkIn: { time: null },
          checkOut: { time: null },
          isLate: false,
        });
      } else if (leave) {
        totalDays.push({
          date: dateKey,
          status: 'on-leave',
          leaveType: leave.type || leave.leaveType,
          workHours: 0,
          checkIn: { time: null },
          checkOut: { time: null },
          isLate: false,
        });
      } else if (hasRealPunch) {
        const isToday = current.isSame(today, 'day');

        let workHours = record.workHours || 0;
        if (isToday) {
          workHours = getCurrentWorkHours(record);
        } else if (record.checkIn?.time && record.checkOut?.time) {
          workHours = computeWorkHours(
            record.checkIn.time,
            record.checkOut.time
          );
        }

        const missedCheckout =
          !isToday && !!record.checkIn?.time && !record.checkOut?.time;

        const {
          _id,
          employee,
          createdAt,
          updatedAt,
          __v,
          ...cleanRecord
        } = record;

        totalDays.push({
          ...cleanRecord,
          date: dateKey,
          status: record.status || 'present',
          workHours,
          missedCheckout,
          holidayName: null,
          holidayType: null,
          isRestrictedHoliday: false,
          isWeeklyOffWork: isWeekend || false,
          checkInTimeFormatted: record.checkIn?.time
            ? formatISTTime(record.checkIn.time)
            : null,
          checkOutTimeFormatted: record.checkOut?.time
            ? formatISTTime(record.checkOut.time)
            : null,
        });
      } else if (isWeekend) {
        totalDays.push({
          date: dateKey,
          status: 'weekly-off',
          workHours: 0,
          checkIn: { time: null },
          checkOut: { time: null },
          isLate: false,
        });
      } else {
        totalDays.push({
          date: dateKey,
          status: 'absent',
          workHours: 0,
          checkIn: { time: null },
          checkOut: { time: null },
          isLate: false,
        });
      }

      current.add(1, 'day');
    }

    const stats = {
      totalDays: totalDays.length,
      present: totalDays.filter((a) => a.status === 'present').length,
      absent: totalDays.filter((a) => a.status === 'absent').length,
      halfDay: totalDays.filter((a) => a.status === 'half-day').length,
      onLeave: totalDays.filter((a) => a.status === 'on-leave').length,

      // Count holidays, but exclude pre-DOJ holidays from the total.
      // If you want pre-DOJ holidays counted too, drop the `!a.isPreDoj` check.
      holiday: totalDays.filter(
        (a) => a.status === 'holiday' && !a.isPreDoj
      ).length,

      weeklyOff: totalDays.filter((a) => a.status === 'weekly-off').length,
      comboOff: totalDays.filter((a) => a.status === 'combo-off').length,

      totalWorkHours: Number(
        totalDays.reduce((s, a) => s + (a.workHours || 0), 0).toFixed(2)
      ),
      lateCount: totalDays.filter((a) => a.isLate).length,

      workedOnHoliday: totalDays.filter(
        (a) => a.status === 'holiday' && a.workedOnHoliday
      ).length,
      workedOnWeeklyOff: totalDays.filter(
        (a) => a.status === 'present' && a.isWeeklyOffWork
      ).length,
      missedCheckouts: totalDays.filter((a) => a.missedCheckout).length,
    };

    res.status(200).json({
      success: true,
      employee: {
        _id: user._id,
        name: user.name,
        email: user.email,
        employeeId: user.employeeId,
        department: user.department,
        designation: user.designation,
      },
      count: totalDays.length,
      stats,
      attendance: totalDays,
    });
  } catch (error) {
    console.error('HR attendance fetch error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};


// @desc    Get today's attendance
// @route   GET /api/attendance/today
// @access  Private
exports.getTodayAttendance = async (req, res) => {
  try {
    const today = getISTMidnight();
    const employeeId = req.user.id;

    // ── Find attendance record ─────────────────────────────────────────────
    const attendance = await Attendance.findOne({
      employee: employeeId,
      date: today,
    }).lean();

    // ── Check if Combo Off exists for today ────────────────────────────────
    const comboOff = await ComboOff.findOne({
      employee: employeeId,
      date: today,
      status: { $in: ['approved', 'used', 'earned'] },
    }).populate('approvedBy', 'name email'); // optional: show approver

    // ── If Combo Off is found, show it clearly ─────────────────────────────
    if (comboOff) {
      return res.status(200).json({
        success: true,
        comboOff: {
          status: comboOff.status,
          remarks: comboOff.remarks || null,
          approvedBy: comboOff.approvedBy || null,
          earnedOn: comboOff.earnedOn || null,
        },
        attendance: null,
        isComboOff: true,
        isCheckedIn: false,
        isCheckedOut: false,
        checkInTimeFormatted: null,
        checkOutTimeFormatted: null,
        currentWorkHours: 0,
        message: 'Today is a Combo Off day',
      });
    }

    // ── Default response when normal attendance exists ─────────────────────
    res.status(200).json({
      success: true,
      isComboOff: false,
      attendance: attendance || null,
      isCheckedIn: !!attendance?.checkIn?.time,
      isCheckedOut: !!attendance?.checkOut?.time,
      checkInTimeFormatted: attendance?.checkIn?.time
        ? formatISTTime(attendance.checkIn.time)
        : null,
      checkOutTimeFormatted: attendance?.checkOut?.time
        ? formatISTTime(attendance.checkOut.time)
        : null,
      currentWorkHours: attendance ? getCurrentWorkHours(attendance) : 0,
    });
  } catch (error) {
    console.error('Get today attendance error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get attendance report
// @route   GET /api/attendance/report
// @access  Private (HR, Admin)
exports.getAttendanceReport = async (req, res) => {
  try {
    const { department, month, year } = req.query;
    const currentYear = year || moment().tz('Asia/Kolkata').year();
    const currentMonth = month || moment().tz('Asia/Kolkata').month() + 1;

    const startDate = moment.tz({ year: currentYear, month: currentMonth - 1, day: 1 }, 'Asia/Kolkata').startOf('day').toDate();
    const endDate = moment.tz({ year: currentYear, month: currentMonth - 1, day: 1 }, 'Asia/Kolkata').endOf('month').toDate();

    const employeeQuery = { isActive: true };
    if (department) employeeQuery.department = department;

    const employees = await User.find(employeeQuery)
      .select('firstName lastName employeeId email department')
      .populate('department', 'name');

    const report = [];
    for (const employee of employees) {
      const attendance = await Attendance.find({
        employee: employee._id,
        date: { $gte: startDate, $lte: endDate },
      });

      report.push({
        employee: {
          id: employee._id,
          employeeId: employee.employeeId,
          name: `${employee.firstName} ${employee.lastName}`,
          email: employee.email,
          department: employee.department?.name,
        },
        stats: {
          present: attendance.filter((a) => a.status === 'present').length,
          absent: attendance.filter((a) => a.status === 'absent').length,
          halfDay: attendance.filter((a) => a.status === 'half-day').length,
          onLeave: attendance.filter((a) => a.status === 'on-leave').length,
          publicHoliday: attendance.filter((a) => a.status === 'public-holiday').length,
          comboOff: attendance.filter((a) => a.status === 'combo-off').length,
          nonWorkingDay: attendance.filter((a) => a.status === 'non-working-day').length,
          totalWorkHours: attendance.reduce((sum, a) => sum + (a.workHours || 0), 0),
          lateCount: attendance.filter((a) => a.isLate).length,
        },
      });
    }

    res.status(200).json({
      success: true,
      month: currentMonth,
      year: currentYear,
      count: report.length,
      report,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Update attendance record
// @route   PUT /api/attendance/:attendanceId
// @access  Private (HR, Admin)
exports.updateAttendance = async (req, res) => {
  try {
    const { checkIn, checkOut, status, notes } = req.body;
    const attendance = await Attendance.findById(req.params.attendanceId);
    if (!attendance) {
      return res.status(404).json({ success: false, message: 'Attendance record not found' });
    }
    if (checkIn?.time) attendance.checkIn.time = new Date(checkIn.time);
    if (checkOut?.time) {
      attendance.checkOut = { time: new Date(checkOut.time), location: attendance.checkOut?.location };
      attendance.workHours = ((new Date(checkOut.time) - attendance.checkIn.time) / (1000 * 60 * 60)).toFixed(2);
    }
    if (status) attendance.status = status;
    if (notes) attendance.notes = notes;
    const standardTime = getISTStandardTime();
    attendance.isLate = attendance.checkIn?.time > standardTime;
    attendance.lateBy = attendance.isLate ? Math.round((attendance.checkIn.time - standardTime) / (1000 * 60)) : 0;
    await attendance.save();
    res.status(200).json({
      success: true,
      attendance: {
        ...attendance.toObject(),
        checkInTimeFormatted: formatISTTime(attendance.checkIn?.time),
        checkOutTimeFormatted: formatISTTime(attendance.checkOut?.time),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Mark leave or special status
// @route   POST /api/attendance/mark-status
// @access  Private (HR, Admin)
exports.markStatus = async (req, res) => {
  try {
    const { employeeId, date, status, notes } = req.body;
    const istDate = moment.tz(date, 'Asia/Kolkata').startOf('day').toDate();
    let attendance = await Attendance.findOne({ employee: employeeId, date: istDate });
    if (attendance) {
      attendance.status = status;
      attendance.notes = notes;
      await attendance.save();
    } else {
      attendance = await Attendance.create({
        employee: employeeId,
        date: istDate,
        status,
        notes,
        checkIn: null,
        checkOut: null,
        workHours: 0,
      });
    }
    res.status(200).json({
      success: true,
      attendance: {
        ...attendance.toObject(),
        checkInTimeFormatted: formatISTTime(attendance.checkIn?.time),
        checkOutTimeFormatted: formatISTTime(attendance.checkOut?.time),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Bulk upload attendance
// @route   POST /api/attendance/bulk-upload
// @access  Private (HR, Admin)
exports.bulkUploadAttendance = async (req, res) => {
  try {
    const { records } = req.body;
    const results = [];
    for (const record of records) {
      const istDate = moment.tz(record.date, 'Asia/Kolkata').startOf('day').toDate();
      const existing = await Attendance.findOne({ employee: record.employeeId, date: istDate });
      if (existing) {
        results.push({ employeeId: record.employeeId, date: record.date, status: 'skipped', reason: 'Record exists' });
        continue;
      }
      const attendance = await Attendance.create({
        employee: record.employeeId,
        date: istDate,
        checkIn: record.checkIn ? { time: new Date(record.checkIn) } : null,
        checkOut: record.checkOut ? { time: new Date(record.checkOut) } : null,
        status: record.status || 'present',
        workHours: record.checkIn && record.checkOut ? ((new Date(record.checkOut) - new Date(record.checkIn)) / (1000 * 60 * 60)).toFixed(2) : 0,
      });
      results.push({ employeeId: record.employeeId, date: record.date, status: 'success' });
    }
    res.status(200).json({ success: true, results });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get attendance summary
// @route   GET /api/attendance/summary
// @access  Private (Manager, HR, Admin)
exports.getAttendanceSummary = async (req, res) => {
  try {
    const { department, startDate, endDate, month, year } = req.query;
    const start = startDate
      ? moment.tz(startDate, 'Asia/Kolkata').startOf('day').toDate()
      : moment.tz({ year: Number(year) || moment().year(), month: (Number(month) || moment().month() + 1) - 1, day: 1 }, 'Asia/Kolkata').startOf('day').toDate();
    const end = endDate ? moment.tz(endDate, 'Asia/Kolkata').endOf('day').toDate() : moment(start).endOf('month').toDate();
    const query = { date: { $gte: start, $lte: end } };
    if (department) {
      const employees = await User.find({ department }).select('_id');
      query.employee = { $in: employees.map((e) => e._id) };
    }
    const attendance = await Attendance.find(query);
    const summary = {
      totalEmployees: department ? await User.countDocuments({ department }) : await User.countDocuments(),
      presentDays: attendance.filter((a) => a.status === 'present').length,
      absentDays: attendance.filter((a) => a.status === 'absent').length,
      totalWorkHours: attendance.reduce((sum, a) => sum + (a.workHours || 0), 0),
      lateCount: attendance.filter((a) => a.isLate).length,
      averageWorkHours: attendance.length ? (attendance.reduce((sum, a) => sum + (a.workHours || 0), 0) / attendance.length).toFixed(2) : 0,
    };
    res.status(200).json({ success: true, summary });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Cancel check-in or check-out
// @route   DELETE /api/attendance/:attendanceId/action
// @access  Private (HR, Admin)
exports.cancelAction = async (req, res) => {
  try {
    const { action } = req.query;
    const attendance = await Attendance.findById(req.params.attendanceId);
    if (!attendance) {
      return res.status(404).json({ success: false, message: 'Attendance record not found' });
    }
    if (action === 'check-in') {
      if (!attendance.checkIn?.time) {
        return res.status(400).json({ success: false, message: 'No check-in to cancel' });
      }
      attendance.checkIn = null;
      attendance.status = 'absent';
      attendance.workHours = 0;
      attendance.isLate = false;
      attendance.lateBy = 0;
    } else if (action === 'check-out') {
      if (!attendance.checkOut?.time) {
        return res.status(400).json({ success: false, message: 'No check-out to cancel' });
      }
      attendance.checkOut = null;
      attendance.workHours = 0;
      attendance.missedCheckout = false;
    } else {
      return res.status(400).json({ success: false, message: 'Invalid action' });
    }
    await attendance.save();
    res.status(200).json({
      success: true,
      attendance: {
        ...attendance.toObject(),
        checkInTimeFormatted: formatISTTime(attendance.checkIn?.time),
        checkOutTimeFormatted: formatISTTime(attendance.checkOut?.time),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get attendance status
// @route   GET /api/attendance/status
// @access  Private
exports.getAttendanceStatus = async (req, res) => {
  try {
    const today = getISTMidnight();

    // 1. Real attendance wins first
    const attendance = await Attendance.findOne({
      employee: req.user.id,
      date: today,
    }).lean();

    if (attendance?.checkOut?.time) {
      return res.status(200).json({
        success: true,
        status: 'checked-out',
        workHours: attendance.workHours || 0,
      });
    }

    if (attendance?.checkIn?.time) {
      return res.status(200).json({
        success: true,
        status: 'checked-in',
        currentWorkHours: getCurrentWorkHours(attendance),
      });
    }

    // 2. Holiday
    const holiday = await Holiday.findOne({
      date: { $gte: today, $lt: new Date(today.getTime() + 86400000) },
      isActive: true,
    }).lean();

    if (holiday) {
      return res.status(200).json({
        success: true,
        status: 'holiday',
        holidayName: holiday.name,
        holidayCategory: holiday.category,
      });
    }

    // 3. Weekend
    const user = await User.findById(req.user.id).select('weekendType');
    const weekendType = user?.weekendType || 'sunday';
    const day = getISTDay(today);
    const isWeekend =
      (weekendType === 'sunday' && day === 0) ||
      (weekendType === 'saturday_sunday' && (day === 0 || day === 6));

    if (isWeekend) {
      return res.status(200).json({ success: true, status: 'weekly-off' });
    }

    // 4. Leave
    const leave = await Leave.findOne({
      employee: req.user.id,
      fromDate: { $lte: today },
      toDate: { $gte: today },
      status: 'approved',
    }).lean();

    if (leave) {
      return res.status(200).json({
        success: true,
        status: 'on-leave',
        leaveType: leave.type || leave.leaveType,
      });
    }

    // 5. Absent
    return res.status(200).json({ success: false, status: 'absent' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getEmployeeAttendance = async (req, res) => {
  try {
    const { startDate, endDate, month, year } = req.query;
    const employeeId = req.params.employeeId;

    const user = await User.findById(employeeId).select(
      'firstName lastName fullName email employeeId weekendType dateOfJoining createdAt'
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found',
      });
    }

    const weekendType = user.weekendType || 'sunday';

    // ── DOJ-safe effective tracking start ─────────────────────────────
    const dojFromProfile = user.dateOfJoining
      ? moment(user.dateOfJoining).tz('Asia/Kolkata').startOf('day')
      : null;

    const firstRealPunch = await Attendance.findOne({
      employee: employeeId,
      'checkIn.time': { $ne: null },
    })
      .sort({ date: 1 })
      .select('date')
      .lean();

    const firstPunchMoment = firstRealPunch
      ? moment(firstRealPunch.date).tz('Asia/Kolkata').startOf('day')
      : null;

    let doj;
    if (dojFromProfile && firstPunchMoment) {
      doj = moment.max(dojFromProfile, firstPunchMoment);
    } else if (dojFromProfile) {
      doj = dojFromProfile;
    } else if (firstPunchMoment) {
      doj = firstPunchMoment;
    } else {
      doj = moment.tz('Asia/Kolkata').startOf('day');
    }

    let start, end;
    if (startDate && endDate) {
      start = moment.tz(startDate, 'Asia/Kolkata').startOf('day');
      end = moment.tz(endDate, 'Asia/Kolkata').endOf('day');
    } else if (month && year) {
      start = moment
        .tz({ year: +year, month: +month - 1, day: 1 }, 'Asia/Kolkata')
        .startOf('day');
      end = moment(start).endOf('month');
    } else {
      start = moment.tz('Asia/Kolkata').startOf('month');
      end = moment(start).endOf('month');
    }

    start = moment.max(start, doj);

    if (start.isAfter(end, 'day')) {
      return res.status(200).json({
        success: true,
        count: 0,
        stats: {
          totalDays: 0,
          present: 0,
          absent: 0,
          halfDay: 0,
          onLeave: 0,
          holiday: 0,
          weeklyOff: 0,
          comboOff: 0,
          totalWorkHours: 0,
          lateCount: 0,
        },
        attendance: [],
        employee: {
          _id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          fullName: user.fullName || `${user.firstName} ${user.lastName}`,
          email: user.email,
          employeeId: user.employeeId,
          weekendType: user.weekendType,
          dateOfJoining: user.dateOfJoining,
        },
      });
    }

    const startUTC = start.clone().utc().toDate();
    const endUTC = end.clone().utc().toDate();

    const [attendance, holidays, comboOffs, leaves] = await Promise.all([
      Attendance.find({
        employee: employeeId,
        date: { $gte: startUTC, $lte: endUTC },
      })
        .sort({ date: -1 })
        .lean(),
      Holiday.find({
        date: { $gte: startUTC, $lte: endUTC },
        isActive: true,
      }).lean(),
      ComboOff.find({
        employee: employeeId,
        date: { $gte: startUTC, $lte: endUTC },
        status: { $in: ['approved', 'used', 'earned'] },
      }).lean(),
      Leave.find({
        employee: employeeId,
        fromDate: { $lte: endUTC },
        toDate: { $gte: startUTC },
        status: 'approved',
      }).lean(),
    ]);

    const attendanceMap = new Map(
      attendance.map((a) => [
        moment(a.date).tz('Asia/Kolkata').format('YYYY-MM-DD'),
        a,
      ])
    );
    const holidayMap = new Map(
      holidays.map((h) => [
        moment(h.date).tz('Asia/Kolkata').format('YYYY-MM-DD'),
        h,
      ])
    );
    const comboOffMap = new Map(
      comboOffs.map((c) => [
        moment(c.date).tz('Asia/Kolkata').format('YYYY-MM-DD'),
        c,
      ])
    );

    const leaveMap = new Map();
    leaves.forEach((l) => {
      let d = moment(l.fromDate).tz('Asia/Kolkata').startOf('day');
      const last = moment(l.toDate).tz('Asia/Kolkata').startOf('day');
      while (d.isSameOrBefore(last, 'day')) {
        leaveMap.set(d.format('YYYY-MM-DD'), l);
        d.add(1, 'day');
      }
    });

    const today = moment.tz('Asia/Kolkata').startOf('day');
    const totalDays = [];
    let current = start.clone();

    while (
      current.isSameOrBefore(end, 'day') &&
      current.isSameOrBefore(today, 'day')
    ) {
      if (current.isBefore(doj, 'day')) {
        current.add(1, 'day');
        continue;
      }

      const dateKey = current.format('YYYY-MM-DD');
      const day = getISTDay(current);

      const record = attendanceMap.get(dateKey);
      const holiday = holidayMap.get(dateKey);
      const comboOff = comboOffMap.get(dateKey);
      const leave = leaveMap.get(dateKey);

      let isWeekend = false;
      if (weekendType === 'sunday') isWeekend = day === 0;
      else if (weekendType === 'saturday_sunday')
        isWeekend = day === 0 || day === 6;

      const hasRealPunch = !!(record && record.checkIn?.time);

      if (comboOff) {
        totalDays.push({
          date: current.toDate(),
          status: 'combo-off',
          comboOffStatus: comboOff.status,
          remarks: comboOff.remarks || null,
          approvedBy: comboOff.approvedBy || null,
          workHours: 0,
          checkIn: { time: null },
          checkOut: { time: null },
          isLate: false,
        });
      } else if (leave) {
        totalDays.push({
          date: current.toDate(),
          status: 'on-leave',
          leaveType: leave.type || leave.leaveType,
          workHours: 0,
          checkIn: { time: null },
          checkOut: { time: null },
          isLate: false,
        });
      } else if (hasRealPunch) {
        const isToday = current.isSame(today, 'day');
        const workHours = isToday
          ? getCurrentWorkHours(record)
          : record.checkOut?.time
            ? computeWorkHours(record.checkIn.time, record.checkOut.time)
            : record.workHours || 0;

        const {
          _id,
          employee,
          createdAt,
          updatedAt,
          __v,
          ...cleanRecord
        } = record;

        totalDays.push({
          ...cleanRecord,
          date: current.toDate(),
          workHours,
          holidayName: holiday?.name || null,
          holidayType: holiday?.type || null,
          isRestrictedHoliday: holiday?.category === 'Restricted',
          isWeeklyOffWork: isWeekend || false,
          checkInTimeFormatted: record.checkIn?.time
            ? formatISTTime(record.checkIn.time)
            : null,
          checkOutTimeFormatted: record.checkOut?.time
            ? formatISTTime(record.checkOut.time)
            : null,
        });
      } else if (holiday) {
        totalDays.push({
          date: current.toDate(),
          status: 'holiday',
          holidayName: holiday.name,
          holidayType: holiday.type,
          holidayCategory: holiday.category,
          workHours: 0,
          checkIn: { time: null },
          checkOut: { time: null },
          isLate: false,
        });
      } else if (isWeekend) {
        totalDays.push({
          date: current.toDate(),
          status: 'weekly-off',
          workHours: 0,
          checkIn: { time: null },
          checkOut: { time: null },
          isLate: false,
        });
      } else {
        totalDays.push({
          date: current.toDate(),
          status: 'absent',
          workHours: 0,
          checkIn: { time: null },
          checkOut: { time: null },
          isLate: false,
        });
      }

      current.add(1, 'day');
    }

    const stats = {
      totalDays: totalDays.length,
      present: totalDays.filter((a) => a.status === 'present').length,
      absent: totalDays.filter((a) => a.status === 'absent').length,
      halfDay: totalDays.filter((a) => a.status === 'half-day').length,
      onLeave: totalDays.filter((a) => a.status === 'on-leave').length,
      holiday: totalDays.filter((a) => a.status === 'holiday').length,
      weeklyOff: totalDays.filter((a) => a.status === 'weekly-off').length,
      comboOff: totalDays.filter((a) => a.status === 'combo-off').length,
      totalWorkHours: Number(
        totalDays.reduce((s, a) => s + (a.workHours || 0), 0).toFixed(2)
      ),
      lateCount: totalDays.filter((a) => a.isLate).length,
    };

    res.status(200).json({
      success: true,
      count: totalDays.length,
      stats,
      attendance: totalDays,
      employee: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: user.fullName || `${user.firstName} ${user.lastName}`,
        email: user.email,
        employeeId: user.employeeId,
        weekendType: user.weekendType,
        dateOfJoining: user.dateOfJoining,
      },
    });
  } catch (error) {
    console.error('Attendance fetch error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Export attendance data
// @route   GET /api/attendance/export
// @access  Private (HR, Admin)
exports.exportAttendance = async (req, res) => {
  try {
    const { department, startDate, endDate, format = 'json' } = req.query;
    const query = {
      date: {
        $gte: moment.tz(startDate, 'Asia/Kolkata').startOf('day').toDate(),
        $lte: moment.tz(endDate, 'Asia/Kolkata').endOf('day').toDate(),
      },
    };
    if (department) {
      const employees = await User.find({ department }).select('_id');
      query.employee = { $in: employees.map((e) => e._id) };
    }
    const attendance = await Attendance.find(query).populate('employee', 'firstName lastName employeeId');
    if (format === 'csv') {
      const csv = attendance.map((a) => ({
        employeeId: a.employee.employeeId,
        name: `${a.employee.firstName} ${a.employee.lastName}`,
        date: moment(a.date).format('YYYY-MM-DD'),
        checkIn: a.checkIn?.time ? formatISTTime(a.checkIn.time) : '',
        checkOut: a.checkOut?.time ? formatISTTime(a.checkOut.time) : '',
        workHours: a.workHours || 0,
        status: a.status,
        isLate: a.isLate,
      }));
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=attendance.csv');
      res.status(200).json(csv); // Use a CSV library like `fast-csv` for actual file streaming
    } else {
      res.status(200).json({
        success: true,
        attendance: attendance.map((a) => ({
          ...a.toObject(),
          checkInTimeFormatted: formatISTTime(a.checkIn?.time),
          checkOutTimeFormatted: formatISTTime(a.checkOut?.time),
        })),
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getTodayAllEmployeesAttendance = async (req, res) => {
  try {
    const today = getISTMidnight();
    const { department } = req.query;

    const employeeQuery = {
      isActive: true,
      role: { $in: NON_ADMIN_ROLES }
    };
    if (department) employeeQuery.department = department;

    const employees = await User.find(employeeQuery)
      .select('firstName lastName employeeId email department role weekendType')
      .populate('department', 'name')
      .lean();

    if (employees.length === 0) {
      return res.status(200).json({
        success: true,
        date: moment(today).tz('Asia/Kolkata').format('YYYY-MM-DD'),
        totalEmployees: 0,
        presentCount: 0,
        attendance: [],
      });
    }

    // Holiday — DO NOT early-return; use it as context
    const holiday = await Holiday.findOne({
      date: { $gte: today, $lt: new Date(today.getTime() + 86400000) },
      isActive: true,
    }).lean();

    const employeeIds = employees.map((e) => e._id);

    const [attendanceRecords, leaves, comboOffs] = await Promise.all([
      Attendance.find({
        date: today,
        employee: { $in: employeeIds },
      }).lean(),

      Leave.find({
        employee: { $in: employeeIds },
        fromDate: { $lte: today },
        toDate: { $gte: today },
        status: 'approved',
      }).lean(),

      ComboOff.find({
        employee: { $in: employeeIds },
        date: today,
        status: { $in: ['approved', 'used', 'earned'] },
      }).lean(),
    ]);

    const attendanceMap = new Map(
      attendanceRecords.map((r) => [r.employee.toString(), r])
    );
    const leaveMap = new Map(leaves.map((l) => [l.employee.toString(), l]));
    const comboOffMap = new Map(comboOffs.map((c) => [c.employee.toString(), c]));

    const todayAttendance = [];

    for (const employee of employees) {
      const empId = employee._id.toString();
      const record = attendanceMap.get(empId);
      const leave = leaveMap.get(empId);
      const comboOff = comboOffMap.get(empId);

      const weekendType = employee.weekendType || 'sunday';
      const day = getISTDay(today);
      const isWeekend =
        (weekendType === 'sunday' && day === 0) ||
        (weekendType === 'saturday_sunday' && (day === 0 || day === 6));

      const baseEmployee = {
        id: employee._id,
        employeeId: employee.employeeId,
        name: `${employee.firstName || ''} ${employee.lastName || ''}`.trim(),
        email: employee.email,
        department: employee.department?.name || 'N/A',
        role: employee.role,
      };

      // Priority: Combo Off → Leave → Attendance → Holiday → Weekend → Absent
      if (comboOff) {
        todayAttendance.push({
          employee: baseEmployee,
          status: 'combo-off',
          comboOffStatus: comboOff.status,
          remarks: comboOff.remarks || null,
          checkIn: null,
          checkOut: null,
          workHours: 0,
          isLate: false,
        });
      } else if (leave) {
        todayAttendance.push({
          employee: baseEmployee,
          status: 'on-leave',
          leaveType: leave.type || leave.leaveType,
          checkIn: null,
          checkOut: null,
          workHours: 0,
          isLate: false,
        });
      } else if (record && record.checkIn?.time) {
        // ✅ Real punch wins over holiday/weekend
        todayAttendance.push({
          employee: baseEmployee,
          status: record.status || 'present',
          checkIn: {
            time: formatISTTime(record.checkIn.time),
            rawTime: record.checkIn.time,
            location: record.checkIn.location,
            deviceInfo: record.checkIn.deviceInfo,
            punchedFrom: record.checkIn.punchedFrom,
            verificationMethod: record.checkIn.verificationMethod,
          },
          checkOut: record.checkOut?.time
            ? {
              time: formatISTTime(record.checkOut.time),
              rawTime: record.checkOut.time,
              location: record.checkOut.location,
              deviceInfo: record.checkOut.deviceInfo,
              punchedFrom: record.checkOut.punchedFrom,
              verificationMethod: record.checkOut.verificationMethod,
            }
            : null,
          workHours: getCurrentWorkHours(record),
          isLate: record.isLate || false,
          lateBy: record.lateBy || 0,
          isShortAttendance: record.isShortAttendance || false,
          shortByMinutes: record.shortByMinutes || 0,
          missedCheckout: record.missedCheckout || false,

          // Context badges
          holidayName: holiday?.name || null,
          holidayCategory: holiday?.category || null,
          isRestrictedHoliday: holiday?.category === 'Restricted',
          isWeeklyOffWork: isWeekend,
        });
      } else if (holiday) {
        todayAttendance.push({
          employee: baseEmployee,
          status: 'holiday',
          holidayName: holiday.name,
          holidayCategory: holiday.category,
          checkIn: null,
          checkOut: null,
          workHours: 0,
          isLate: false,
        });
      } else if (isWeekend) {
        todayAttendance.push({
          employee: baseEmployee,
          status: 'weekly-off',
          checkIn: null,
          checkOut: null,
          workHours: 0,
          isLate: false,
        });
      } else {
        todayAttendance.push({
          employee: baseEmployee,
          status: 'absent',
          checkIn: null,
          checkOut: null,
          workHours: 0,
          isLate: false,
        });
      }
    }

    const presentCount = todayAttendance.filter(a => a.status === 'present').length;
    const absentCount = todayAttendance.filter(a => a.status === 'absent').length;
    const onLeaveCount = todayAttendance.filter(a => a.status === 'on-leave').length;
    const weeklyOffCount = todayAttendance.filter(a => a.status === 'weekly-off').length;
    const comboOffCount = todayAttendance.filter(a => a.status === 'combo-off').length;
    const holidayCount = todayAttendance.filter(a => a.status === 'holiday').length;
    const lateCount = todayAttendance.filter(a => a.isLate).length;

    res.status(200).json({
      success: true,
      date: moment(today).tz('Asia/Kolkata').format('YYYY-MM-DD'),
      holiday: holiday ? { name: holiday.name, category: holiday.category } : null,
      totalEmployees: employees.length,
      presentCount,
      absentCount,
      onLeaveCount,
      weeklyOffCount,
      comboOffCount,
      holidayCount,
      lateCount,
      attendance: todayAttendance,
    });
  } catch (error) {
    console.error('Get today all employees attendance error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAllEmployeesAttendance = async (req, res) => {
  try {
    const { department, date } = req.query;

    let targetDate;
    if (date) {
      const parsed = moment.tz(date, 'YYYY-MM-DD', 'Asia/Kolkata');
      if (!parsed.isValid()) {
        return res.status(400).json({
          success: false,
          message: 'Invalid date format. Use YYYY-MM-DD',
        });
      }
      targetDate = parsed.startOf('day').toDate();
    } else {
      targetDate = getISTMidnight();
    }

    const employeeQuery = {
      isActive: true,
      role: { $in: NON_ADMIN_ROLES }
    };
    if (department) employeeQuery.department = department;

    const employees = await User.find(employeeQuery)
      .select('firstName lastName employeeId email department role weekendType')
      .populate('department', 'name')
      .lean();

    if (employees.length === 0) {
      return res.status(200).json({
        success: true,
        date: moment(targetDate).tz('Asia/Kolkata').format('YYYY-MM-DD'),
        totalEmployees: 0,
        presentCount: 0,
        attendance: [],
      });
    }

    const employeeIds = employees.map((e) => e._id);

    // Holiday — no early return, treat as context
    const holiday = await Holiday.findOne({
      date: { $gte: targetDate, $lt: new Date(targetDate.getTime() + 86400000) },
      isActive: true,
    }).lean();

    const [attendanceRecords, leaves, comboOffs] = await Promise.all([
      Attendance.find({
        date: targetDate,
        employee: { $in: employeeIds },
      }).lean(),

      Leave.find({
        employee: { $in: employeeIds },
        fromDate: { $lte: targetDate },
        toDate: { $gte: targetDate },
        status: 'approved',
      }).lean(),

      ComboOff.find({
        employee: { $in: employeeIds },
        date: targetDate,
        status: { $in: ['approved', 'used', 'earned'] },
      }).lean(),
    ]);

    const attendanceMap = new Map(
      attendanceRecords.map((r) => [r.employee.toString(), r])
    );
    const leaveMap = new Map(leaves.map((l) => [l.employee.toString(), l]));
    const comboOffMap = new Map(comboOffs.map((c) => [c.employee.toString(), c]));

    const dayIST = getISTDay(targetDate);
    const isToday =
      moment(targetDate).tz('Asia/Kolkata').format('YYYY-MM-DD') ===
      moment().tz('Asia/Kolkata').format('YYYY-MM-DD');

    const attendanceList = employees.map((employee) => {
      const empId = employee._id.toString();
      const record = attendanceMap.get(empId);
      const leave = leaveMap.get(empId);
      const comboOff = comboOffMap.get(empId);

      const weekendType = employee.weekendType || 'sunday';
      const isWeekend =
        (weekendType === 'sunday' && dayIST === 0) ||
        (weekendType === 'saturday_sunday' && (dayIST === 0 || dayIST === 6));

      const baseEmployee = {
        id: employee._id,
        employeeId: employee.employeeId,
        name: `${employee.firstName || ''} ${employee.lastName || ''}`.trim(),
        email: employee.email,
        department: employee.department?.name || 'N/A',
        role: employee.role,
      };

      // Priority: Combo Off → Leave → Attendance → Holiday → Weekend → Absent
      if (comboOff) {
        return {
          employee: baseEmployee,
          status: 'combo-off',
          comboOffStatus: comboOff.status,
          remarks: comboOff.remarks || null,
          checkIn: null,
          checkOut: null,
          workHours: 0,
          isLate: false,
        };
      }

      if (leave) {
        return {
          employee: baseEmployee,
          status: 'on-leave',
          leaveType: leave.type || leave.leaveType,
          checkIn: null,
          checkOut: null,
          workHours: 0,
          isLate: false,
        };
      }

      if (record && record.checkIn?.time) {
        // ✅ Real punch wins
        const workHours = isToday
          ? getCurrentWorkHours(record)
          : (record.checkOut?.time
            ? computeWorkHours(record.checkIn.time, record.checkOut.time)
            : record.workHours || 0);

        const missedCheckout = !isToday && !record.checkOut?.time;

        return {
          employee: baseEmployee,
          status: record.status || 'present',
          checkIn: {
            time: formatISTTime(record.checkIn.time),
            rawTime: record.checkIn.time,
            location: record.checkIn.location,
            deviceInfo: record.checkIn.deviceInfo,
            punchedFrom: record.checkIn.punchedFrom,
            verificationMethod: record.checkIn.verificationMethod,
            isGpsBypassed: record.checkIn.isGpsBypassed,
          },
          checkOut: record.checkOut?.time
            ? {
              time: formatISTTime(record.checkOut.time),
              rawTime: record.checkOut.time,
              location: record.checkOut.location,
              deviceInfo: record.checkOut.deviceInfo,
              punchedFrom: record.checkOut.punchedFrom,
              verificationMethod: record.checkOut.verificationMethod,
              isGpsBypassed: record.checkOut.isGpsBypassed,
            }
            : null,
          workHours,
          missedCheckout,
          isLate: record.isLate || false,
          lateBy: record.lateBy || 0,
          isShortAttendance: record.isShortAttendance || false,
          shortByMinutes: record.shortByMinutes || 0,

          // Context badges
          holidayName: holiday?.name || null,
          holidayCategory: holiday?.category || null,
          isRestrictedHoliday: holiday?.category === 'Restricted',
          isWeeklyOffWork: isWeekend,
        };
      }

      if (holiday) {
        return {
          employee: baseEmployee,
          status: 'holiday',
          holidayName: holiday.name,
          holidayCategory: holiday.category,
          checkIn: null,
          checkOut: null,
          workHours: 0,
          isLate: false,
        };
      }

      if (isWeekend) {
        return {
          employee: baseEmployee,
          status: 'weekly-off',
          checkIn: null,
          checkOut: null,
          workHours: 0,
          isLate: false,
        };
      }

      return {
        employee: baseEmployee,
        status: 'absent',
        checkIn: null,
        checkOut: null,
        workHours: 0,
        isLate: false,
      };
    });

    const stats = {
      totalEmployees: employees.length,
      presentCount: attendanceList.filter((a) => a.status === 'present').length,
      absentCount: attendanceList.filter((a) => a.status === 'absent').length,
      onLeaveCount: attendanceList.filter((a) => a.status === 'on-leave').length,
      weeklyOffCount: attendanceList.filter((a) => a.status === 'weekly-off').length,
      comboOffCount: attendanceList.filter((a) => a.status === 'combo-off').length,
      holidayCount: attendanceList.filter((a) => a.status === 'holiday').length,
      lateCount: attendanceList.filter((a) => a.isLate).length,
    };

    res.status(200).json({
      success: true,
      date: moment(targetDate).tz('Asia/Kolkata').format('YYYY-MM-DD'),
      holiday: holiday ? { name: holiday.name, category: holiday.category } : null,
      ...stats,
      attendance: attendanceList,
    });
  } catch (error) {
    console.error('Get employees attendance error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};


// ─────────────────────────────────────────────────────────────────────────────
// @desc  Get work-hours data for a chart (daily totals)
// @route GET /api/attendance/work-hours-chart
// @access Private (any logged-in user – shows only own data)
// ─────────────────────────────────────────────────────────────────────────────
exports.getEmployeeWorkHoursChart = async (req, res) => {
  try {
    const employeeId = req.user.id;

    // ── Optional query params ─────────────────────────────────────────────
    const { startDate, endDate, month, year } = req.query;

    // Build the date range (IST)
    let start, end;
    const tz = 'Asia/Kolkata';

    if (startDate && endDate) {
      start = moment.tz(startDate, tz).startOf('day');
      end = moment.tz(endDate, tz).endOf('day');
    } else if (month && year) {
      start = moment.tz({ year: +year, month: +month - 1, day: 1 }, tz).startOf('day');
      end = moment(start).endOf('month');
    } else {
      // default = current month
      start = moment.tz(tz).startOf('month');
      end = moment.tz(tz).endOf('month');
    }

    const startUTC = start.clone().utc().toDate();
    const endUTC = end.clone().utc().toDate();

    // ── Pull only the fields we need ─────────────────────────────────────
    const records = await Attendance.find({
      employee: employeeId,
      date: { $gte: startUTC, $lte: endUTC },
      status: 'present',                 // only days where user actually worked
    })
      .select('date workHours')
      .sort({ date: 1 })
      .lean();

    // ── Build a map: dateString → workHours ───────────────────────────────
    const dataMap = new Map();
    records.forEach(r => {
      const key = moment(r.date).tz(tz).format('YYYY-MM-DD');
      dataMap.set(key, parseFloat(r.workHours) || 0);
    });

    // ── Fill missing days with 0 (so the chart has a continuous line) ─────
    const chartData = [];
    let cur = start.clone();

    while (cur.isSameOrBefore(end, 'day')) {
      const key = cur.format('YYYY-MM-DD');
      chartData.push({
        date: key,
        label: cur.format('DD MMM'),          // e.g. "13 Nov"
        day: cur.format('ddd'),             // Mon, Tue…
        workHours: dataMap.get(key) ?? 0,
      });
      cur.add(1, 'day');
    }

    // ── Optional summary ─────────────────────────────────────────────────
    const totalHours = chartData.reduce((s, d) => s + d.workHours, 0);
    const avgHours = chartData.length ? (totalHours / chartData.length).toFixed(2) : '0';

    res.status(200).json({
      success: true,
      period: {
        from: start.format('YYYY-MM-DD'),
        to: end.format('YYYY-MM-DD'),
      },
      summary: {
        totalWorkHours: +totalHours.toFixed(2),
        averageDaily: +avgHours,
        workingDays: records.length,
      },
      chart: chartData,          // <-- plug straight into Chart.js
    });
  } catch (error) {
    console.error('Work-hours chart error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// @desc  Get work-hours data for a chart (daily totals)
// @route GET /api/attendance/work-hours-chart
// @access Private (logged-in user → own data)
// ─────────────────────────────────────────────────────────────────────────────
exports.getWorkHoursChartMonthly = async (req, res) => {
  try {
    const employeeId = req.user.id;
    const tz = 'Asia/Kolkata';

    // ── 1. Build date range (default = current month in IST) ─────────────
    let start, end;

    const { startDate, endDate, month, year } = req.query;

    if (startDate && endDate) {
      // Custom range
      start = moment.tz(startDate, tz).startOf('day');
      end = moment.tz(endDate, tz).endOf('day');
    } else if (month && year) {
      // Specific month/year
      start = moment.tz({ year: +year, month: +month - 1, day: 1 }, tz).startOf('day');
      end = moment(start).endOf('month');
    } else {
      // DEFAULT: current month in IST
      const now = moment.tz(tz);
      start = now.clone().startOf('month');
      end = now.clone().endOf('month');
    }

    const startUTC = start.clone().utc().toDate();
    const endUTC = end.clone().utc().toDate();

    // ── 2. Fetch attendance (only present days) ─────────────────────────
    const records = await Attendance.find({
      employee: employeeId,
      date: { $gte: startUTC, $lte: endUTC },
      status: 'present',
    })
      .select('date workHours')
      .sort({ date: 1 })
      .lean();

    // ── 3. Map: dateString → workHours ───────────────────────────────────
    const dataMap = new Map();
    records.forEach(r => {
      const key = moment(r.date).tz(tz).format('YYYY-MM-DD');
      dataMap.set(key, parseFloat(r.workHours) || 0);
    });

    // ── 4. Build continuous daily array (fill 0 for missing days) ───────
    const chartData = [];
    let cur = start.clone();

    while (cur.isSameOrBefore(end, 'day')) {
      const key = cur.format('YYYY-MM-DD');
      chartData.push({
        date: key,
        label: cur.format('DD MMM'),   // 01 Nov, 02 Nov...
        day: cur.format('ddd'),        // Mon, Tue...
        workHours: dataMap.get(key) ?? 0,
      });
      cur.add(1, 'day');
    }

    // ── 5. Summary ───────────────────────────────────────────────────────
    const totalHours = chartData.reduce((s, d) => s + d.workHours, 0);
    const avgHours = chartData.length ? (totalHours / chartData.filter(d => d.workHours > 0).length || 1).toFixed(2) : '0';

    // ── 6. Response ──────────────────────────────────────────────────────
    res.status(200).json({
      success: true,
      period: {
        from: start.format('YYYY-MM-DD'),
        to: end.format('YYYY-MM-DD'),
        display: start.format('MMM YYYY'), // e.g. "Nov 2025"
      },
      summary: {
        totalWorkHours: +totalHours.toFixed(2),
        averageDaily: +avgHours,
        workingDays: records.length,
      },
      chart: chartData,
    });

  } catch (error) {
    console.error('Work-hours chart error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Export Monthly Attendance Report (FULL HR VERSION - FIXED)
// @route   GET /api/attendance/export-monthly?month=12&year=2025&format=xlsx
// @access  Private (hr, superadmin)
exports.exportMonthlyAttendanceExcel = async (req, res) => {
  try {
    const { month, year, format = 'xlsx', department } = req.query;

    const now = moment().tz('Asia/Kolkata');
    const selectedMonth = month ? parseInt(month) : now.month() + 1;
    const selectedYear = year ? parseInt(year) : now.year();

    if (selectedMonth < 1 || selectedMonth > 12) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid month' });
    }

    const startDate = moment
      .tz(
        { year: selectedYear, month: selectedMonth - 1, day: 1 },
        'Asia/Kolkata'
      )
      .startOf('day');
    const endDate = startDate.clone().endOf('month').endOf('day');

    const employeeQuery = {
      isActive: true,
      role: { $nin: ['admin', 'superadmin'] },
    };
    if (department) employeeQuery.department = department;

    const employees = await User.find(employeeQuery)
      .select(
        'firstName lastName employeeId email department designation weekendType role dateOfJoining'
      )
      .populate('department', 'name')
      .lean();

    if (employees.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: 'No employees found' });
    }

    const [attendances, holidays, comboOffs, leaves] = await Promise.all([
      Attendance.find({
        date: { $gte: startDate.toDate(), $lte: endDate.toDate() },
      }).lean(),
      Holiday.find({
        date: { $gte: startDate.toDate(), $lte: endDate.toDate() },
        isActive: true,
      }).lean(),
      ComboOff.find({
        date: { $gte: startDate.toDate(), $lte: endDate.toDate() },
        status: { $in: ['approved', 'earned', 'used'] },
      }).lean(),
      Leave.find({
        fromDate: { $lte: endDate.toDate() },
        toDate: { $gte: startDate.toDate() },
        status: 'approved',
      }).lean(),
    ]);

    const holidayMap = new Map(
      holidays.map((h) => [
        moment(h.date).tz('Asia/Kolkata').format('YYYY-MM-DD'),
        h.name,
      ])
    );
    const comboOffMap = new Map(
      comboOffs.map((c) => [
        c.employee.toString() +
        '-' +
        moment(c.date).tz('Asia/Kolkata').format('YYYY-MM-DD'),
        true,
      ])
    );

    const leaveMap = new Map();
    leaves.forEach((leave) => {
      let current = moment(leave.fromDate).tz('Asia/Kolkata').startOf('day');
      const end = moment(leave.toDate).tz('Asia/Kolkata').startOf('day');
      while (current.isSameOrBefore(end, 'day')) {
        const key =
          leave.employee.toString() +
          '-' +
          current.format('YYYY-MM-DD');
        leaveMap.set(key, {
          type: leave.type || leave.leaveType,
          duration: leave.leaveDuration || leave.duration || 'full',
          halfDayType: leave.halfDayType,
        });
        current.add(1, 'day');
      }
    });

    const attendanceMap = new Map();
    attendances.forEach((a) => {
      const key =
        a.employee.toString() +
        '-' +
        moment(a.date).tz('Asia/Kolkata').format('YYYY-MM-DD');
      attendanceMap.set(key, a);
    });

    const rows = [];

    for (const emp of employees) {
      const weekendType = emp.weekendType || 'sunday';
      const empDoj = emp.dateOfJoining
        ? moment(emp.dateOfJoining).tz('Asia/Kolkata').startOf('day')
        : startDate.clone();

      let present = 0,
        absent = 0,
        onLeave = 0,
        halfDays = 0;
      let lateCount = 0,
        totalLateMins = 0,
        shortCount = 0,
        totalShortMins = 0;
      let totalHours = 0,
        overtimeHours = 0;
      let firstCheckIn = null,
        lastCheckOut = null;
      let weeklyOffs = 0,
        holidaysCount = 0,
        comboOffUsed = 0;

      let current = startDate.clone();
      while (current.isSameOrBefore(endDate, 'day')) {
        // ── Skip pre-joining days ──
        if (current.isBefore(empDoj, 'day')) {
          current.add(1, 'day');
          continue;
        }

        const dateStr = current.format('YYYY-MM-DD');
        const day = current.day();
        const key = emp._id.toString() + '-' + dateStr;

        const isWeekend =
          (weekendType === 'sunday' && day === 0) ||
          (weekendType === 'saturday_sunday' &&
            (day === 0 || day === 6));
        const isHoliday = holidayMap.has(dateStr);
        const isComboOff = comboOffMap.has(key);
        const leaveData = leaveMap.get(key);
        const record = attendanceMap.get(key);

        if (isWeekend) weeklyOffs++;
        if (isHoliday) holidaysCount++;
        if (isComboOff) comboOffUsed++;

        if (isComboOff || isHoliday || isWeekend) {
          // Skip (non-working context)
        } else if (leaveData) {
          if (leaveData.duration === 'half') {
            onLeave += 0.5;
            halfDays++;
          } else {
            onLeave += 1;
          }
        } else if (record && record.checkIn?.time) {
          // ✅ Only a real punch wins over holiday/weekend
          const isToday = current.isSame(today, 'day');

          let workHours = record.workHours || 0;
          if (isToday) {
            workHours = getCurrentWorkHours(record);
          } else if (record.checkIn?.time && record.checkOut?.time) {
            workHours = computeWorkHours(record.checkIn.time, record.checkOut.time);
          }

          const missedCheckout =
            !isToday && !!record.checkIn?.time && !record.checkOut?.time;

          const { _id, employee, createdAt, updatedAt, __v, ...cleanRecord } = record;

          totalDays.push({
            ...cleanRecord,
            date: dateKey,
            status: record.status || 'present',
            workHours,
            missedCheckout,
            holidayName: holiday?.name || null,
            holidayType: holiday?.type || null,
            isRestrictedHoliday: holiday?.category === 'Restricted',
            isWeeklyOffWork: isWeekend || false,
            checkInTimeFormatted: record.checkIn?.time
              ? formatISTTime(record.checkIn.time)
              : null,
            checkOutTimeFormatted: record.checkOut?.time
              ? formatISTTime(record.checkOut.time)
              : null,
          });
        } else {
          absent++;
        }
        current.add(1, 'day');
      }

      const workableDays = present + absent + onLeave;
      const attendancePercent =
        workableDays > 0
          ? (((present + halfDays * 0.5) / workableDays) * 100).toFixed(2)
          : '0.00';

      rows.push({
        'Emp ID': emp.employeeId || '-',
        'Employee Name': `${emp.firstName} ${emp.lastName}`.trim(),
        Department: emp.department?.name || 'N/A',
        Designation: emp.designation || 'N/A',
        Email: emp.email,
        Month: startDate.format('MMMM YYYY'),
        'Total Days': startDate.daysInMonth(),
        'Working Days': workableDays.toFixed(1),
        Present: present,
        'Half Days': halfDays,
        Absent: absent,
        'On Leave':
          onLeave % 1 === 0 ? onLeave : parseFloat(onLeave.toFixed(1)),
        'Weekly Offs': weeklyOffs,
        Holidays: holidaysCount,
        'Combo Off Used': comboOffUsed,
        'Late Arrivals': lateCount,
        'Late By (Mins)': totalLateMins,
        'Short Attendance': shortCount,
        'Short By (Mins)': totalShortMins,
        'Total Work Hours': totalHours.toFixed(2),
        'Avg Hours/Present Day':
          present > 0 ? (totalHours / present).toFixed(2) : '0.00',
        'Overtime Hours': overtimeHours.toFixed(2),
        'First Check-in': firstCheckIn
          ? moment(firstCheckIn)
            .tz('Asia/Kolkata')
            .format('DD MMM, hh:mm A')
          : '-',
        'Last Check-out': lastCheckOut
          ? moment(lastCheckOut)
            .tz('Asia/Kolkata')
            .format('DD MMM, hh:mm A')
          : '-',
        'Attendance %': attendancePercent + '%',
      });
    }

    rows.sort((a, b) => a['Employee Name'].localeCompare(b['Employee Name']));

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(
      `Attendance - ${startDate.format('MMM YYYY')}`
    );

    worksheet.columns = Object.keys(rows[0]).map((key) => ({
      header: key,
      key,
      width: [
        'Employee Name',
        'Email',
        'First Check-in',
        'Last Check-out',
      ].includes(key)
        ? 28
        : 18,
    }));

    worksheet.addRows(rows);

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E40AF' },
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

    worksheet.mergeCells(
      'A1:' +
      String.fromCharCode(64 + worksheet.columns.length) +
      '1'
    );
    const titleCell = worksheet.getCell('A1');
    titleCell.value = `Monthly Attendance Report - ${startDate.format(
      'MMMM YYYY'
    )}`;
    titleCell.font = {
      bold: true,
      size: 18,
      color: { argb: 'FF1E40AF' },
    };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

    worksheet.spliceRows(2, 0, []);
    worksheet.getRow(3).values = worksheet.columns.map((c) => c.header);
    worksheet.getRow(3).font = { bold: true };
    worksheet.getRow(3).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF3F4F6' },
    };

    const fileName = `Attendance_Report_${selectedMonth}_${selectedYear}.${format === 'csv' ? 'csv' : 'xlsx'
      }`;
    res.setHeader(
      'Content-Type',
      format === 'csv'
        ? 'text/csv'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${fileName}"`
    );

    if (format === 'csv') {
      await workbook.csv.write(res);
    } else {
      await workbook.xlsx.write(res);
    }
    res.end();
  } catch (error) {
    console.error('Export Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};