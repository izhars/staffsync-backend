// controllers/expenseController.js
const Expense = require('../models/Expense');
const Category = require('../models/ExpenseCategory');
const { validationResult } = require('express-validator');
const AppError = require('../utils/appError');

// ✅ UPDATE THIS IMPORT - Use the specialized functions
const { 
  uploadExpenseFile,  // Specialized for expenses
  deleteFromCloudinary  // Keep this helper
} = require('../middleware/upload');

// CREATE EXPENSE (Draft by default) - UPDATED TO STORE PUBLIC_ID
// CREATE EXPENSE (Draft by default) - UPDATED
exports.createExpense = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        // Check category
        const category = await Category.findOne({
            _id: req.body.category,
            isActive: true
        });

        if (!category) {
            throw new AppError('Category not found or inactive', 404);
        }

        if (category.maxAmount && req.body.amount > category.maxAmount) {
            throw new AppError(
                `Amount exceeds maximum of ${category.maxAmount} for ${category.name}`,
                400
            );
        }

        // Upload to Cloudinary if file exists
        let receiptUrl = null;
        let receiptPublicId = null;

        if (req.file) {
            try {
                // ✅ USE THE SPECIALIZED FUNCTION
                const uploadResult = await uploadExpenseFile(req.file.buffer);
                receiptUrl = uploadResult.url;
                receiptPublicId = uploadResult.publicId;
            } catch (uploadError) {
                console.error('[CreateExpense] Cloudinary upload failed:', uploadError);
                throw new AppError('Failed to upload receipt to cloud storage', 500);
            }
        }

        // Create expense as draft
        const expenseData = {
            ...req.body,
            employee: req.user.id,
            receipt: receiptUrl,
            receiptPublicId: receiptPublicId,
            status: 'draft'
        };

        const expense = new Expense(expenseData);
        await expense.save();

        res.status(201).json({
            success: true,
            data: expense
        });
    } catch (error) {
        console.error('[CreateExpense] Error creating expense:', error);
        next(error);
    }
};


// UPDATE EXPENSE (Only if draft) - WITH CLOUDINARY CLEANUP
// UPDATE EXPENSE (Only if draft) - WITH CLOUDINARY CLEANUP
exports.updateExpense = async (req, res, next) => {
    try {

        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const expense = await Expense.findOne({
            _id: req.params.id,
            employee: req.user.id
        });

        if (!expense) {
            throw new AppError('Expense not found', 404);
        }

        if (expense.status !== 'draft') {
            throw new AppError('Can only update draft expenses', 400);
        }

        // Upload to Cloudinary if file exists
        let receiptUrl = expense.receipt;
        let receiptPublicId = expense.receiptPublicId;

        if (req.file) {

            // Delete old receipt from Cloudinary if it exists
            if (receiptPublicId) {
                try {
                    await deleteFromCloudinary(receiptPublicId);
                } catch (deleteError) {
                    console.error('[UpdateExpense] Failed to delete old receipt from Cloudinary:', deleteError);
                    // Don't throw error here, just log it
                }
            }

            try {
                const uploadResult = await uploadExpenseFile(req.file.buffer);
                receiptUrl = uploadResult.url;
                receiptPublicId = uploadResult.publicId;
            } catch (uploadError) {
                console.error('[UpdateExpense] Cloudinary upload failed:', uploadError);
                throw new AppError('Failed to upload receipt to cloud storage', 500);
            }
        } else {
            console.log('[UpdateExpense] No new file provided, keeping existing receipt');
        }

        // Update other fields
        const updateData = {
            ...req.body,
            receipt: receiptUrl,
            receiptPublicId: receiptPublicId
        };

        Object.keys(updateData).forEach(key => {
            if (updateData[key] !== undefined) {
                expense[key] = updateData[key];
            }
        });

        await expense.save();

        res.json({
            success: true,
            data: expense,
            message: 'Expense updated successfully'
        });
    } catch (error) {
        console.error('[UpdateExpense] Error:', error);
        next(error);
    }
};


// DELETE EXPENSE (Only if draft) - WITH CLOUDINARY CLEANUP
exports.deleteExpense = async (req, res, next) => {
    try {

        const expense = await Expense.findOne({
            _id: req.params.id,
            employee: req.user.id
        });

        if (!expense) {
            throw new AppError('Expense not found', 404);
        }

        if (expense.status !== 'draft') {
            throw new AppError('Can only delete draft expenses', 400);
        }

        // Delete from Cloudinary if receipt exists
        if (expense.receiptPublicId) {
            try {
                await deleteFromCloudinary(expense.receiptPublicId);
            } catch (cloudinaryError) {
                console.error('[DeleteExpense] Failed to delete from Cloudinary:', cloudinaryError);
                // Continue with deletion even if Cloudinary fails
            }
        }

        await expense.deleteOne();
        res.json({
            success: true,
            message: 'Expense deleted successfully'
        });
    } catch (error) {
        console.error('[DeleteExpense] Error:', error);
        next(error);
    }
};

// SUBMIT EXPENSE (Draft → Submitted)
exports.submitExpense = async (req, res, next) => {
    try {
        const expense = await Expense.findOne({
            _id: req.params.id,
            employee: req.user.id
        });

        if (!expense) {
            throw new AppError('Expense not found', 404);
        }

        if (expense.status !== 'draft') {
            throw new AppError('Only draft expenses can be submitted', 400);
        }

        // Validate required fields before submission
        if (!expense.amount || !expense.category || !expense.description) {
            throw new AppError('Missing required fields for submission', 400);
        }

        expense.status = 'submitted';
        expense.submittedAt = new Date();
        await expense.save();

        // TODO: Send notification to HR

        res.json({
            success: true,
            data: expense,
            message: 'Expense submitted for HR approval'
        });
    } catch (error) {
        next(error);
    }
};

// GET MY EXPENSES (Employee view)
exports.getMyExpenses = async (req, res, next) => {
    try {
        const {
            status,
            startDate,
            endDate,
            category,
            limit = 50,
            page = 1
        } = req.query;

        const query = { employee: req.user.id };

        if (status) query.status = status;
        if (category) query.category = category;

        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate);
            if (endDate) query.createdAt.$lte = new Date(endDate);
        }

        const skip = (page - 1) * limit;

        const expenses = await Expense.find(query)
            .populate('category', 'name description')
            .populate('approvedBy', 'name email')
            .populate('rejectedBy', 'name email')
            .sort('-createdAt')
            .skip(skip)
            .limit(parseInt(limit));

        res.json({
            success: true,
            count: expenses.length,
            data: expenses
        });
    } catch (error) {
        next(error);
    }
};

// GET SUBMITTED EXPENSES FOR HR
exports.getExpensesForHR = async (req, res, next) => {
    try {
        const {
            startDate,
            endDate,
            category,
            department,
            limit = 50,
            page = 1
        } = req.query;

        const query = { status: 'submitted' };

        // Filter by date range
        if (startDate || endDate) {
            query.submittedAt = {};
            if (startDate) query.submittedAt.$gte = new Date(startDate);
            if (endDate) query.submittedAt.$lte = new Date(endDate);
        }

        if (category) query.category = category;

        const skip = (page - 1) * limit;

        // Get expenses with population
        let expenses = await Expense.find(query)
            .populate('employee', 'name email department')
            .populate('category', 'name description')
            .sort('-submittedAt')
            .skip(skip)
            .limit(parseInt(limit));

        // Filter by department if specified
        if (department) {
            expenses = expenses.filter(expense =>
                expense.employee && expense.employee.department === department
            );
        }

        res.json({
            success: true,
            count: expenses.length,
            data: expenses
        });
    } catch (error) {
        next(error);
    }
};

// HR APPROVE/REJECT EXPENSE
exports.hrApproveExpense = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { status, comments } = req.body;

        if (!['approved', 'rejected'].includes(status)) {
            throw new AppError('Invalid approval status', 400);
        }

        const expense = await Expense.findById(req.params.id)
            .populate('employee', 'name email');

        if (!expense) {
            throw new AppError('Expense not found', 404);
        }

        if (expense.status !== 'submitted') {
            throw new AppError(`Expense is '${expense.status}', cannot process`, 400);
        }

        if (status === 'rejected') {
            expense.status = 'draft'; // Return to employee for editing
            expense.hrComments = comments;
            expense.rejectionReason = comments;
            expense.rejectedBy = req.user.id;
            expense.rejectedAt = new Date();
        } else if (status === 'approved') {
            expense.status = 'approved';
            expense.approvedBy = req.user.id;
            expense.approvedAt = new Date();
            expense.approvalComments = comments;
            // TODO: Trigger payment processing
        }

        await expense.save();

        // TODO: Send notification to employee

        res.json({
            success: true,
            data: expense,
            message: `Expense ${status} successfully`
        });
    } catch (err) {
        next(err);
    }
};

// GET SINGLE EXPENSE (Fixed version)
exports.getExpenseById = async (req, res, next) => {
    try {
        const expenseId = req.params.id;

        console.log(`[getExpenseById] Looking for expense with ID: ${expenseId}`);
        console.log(`[getExpenseById] User ID: ${req.user.id}, Roles: ${req.user.roles}`);

        // First, try to find the expense without population to debug
        const expenseExists = await Expense.findById(expenseId).lean();
        console.log(`[getExpenseById] Raw expense found:`, expenseExists);

        if (!expenseExists) {
            console.log(`[getExpenseById] No expense found with ID: ${expenseId}`);
            throw new AppError('Expense not found', 404);
        }

        // Now populate with all necessary data
        const expense = await Expense.findById(expenseId)
            .populate('employee', 'name email department')
            .populate('category', 'name description')
            .populate('approvedBy', 'name email')
            .populate('rejectedBy', 'name email');

        if (!expense) {
            console.log(`[getExpenseById] Expense population failed for ID: ${expenseId}`);
            throw new AppError('Expense not found', 404);
        }

        console.log(`[getExpenseById] Expense found:`, {
            id: expense._id,
            employeeId: expense.employee?._id?.toString(),
            userId: req.user.id,
            status: expense.status,
            isOwner: expense.employee?._id?.toString() === req.user.id
        });

        // Authorization check
        const isOwner = expense.employee && expense.employee._id.toString() === req.user.id;
        const isHR = req.user.roles && (req.user.roles.includes('hr') || req.user.roles.includes('admin'));

        console.log(`[getExpenseById] Authorization check - isOwner: ${isOwner}, isHR: ${isHR}`);

        if (!isOwner && !isHR) {
            throw new AppError('Not authorized to view this expense', 403);
        }

        // HR can only see submitted expenses (not drafts)
        if (isHR && expense.status === 'draft') {
            throw new AppError('Not authorized to view draft expenses', 403);
        }

        res.json({
            success: true,
            data: expense
        });
    } catch (error) {
        console.error(`[getExpenseById] Error:`, error);
        next(error);
    }
};

// HR: GET ALL EXPENSES (with filters)
exports.getAllExpensesForHR = async (req, res, next) => {
    try {
        const {
            status,
            startDate,
            endDate,
            category,
            department,
            employee,
            search,
            page = 1,
            limit = 50,
            sortBy = '-submittedAt'
        } = req.query;

        const query = {};

        // HR can see all non-draft expenses
        query.status = { $ne: 'draft' };

        // Status filter
        if (status && status !== 'all') {
            query.status = status;
        }

        // Date range filter
        if (startDate || endDate) {
            const dateField = status === 'submitted' ? 'submittedAt' : 'createdAt';
            query[dateField] = {};

            if (startDate) {
                query[dateField].$gte = new Date(startDate);
            }
            if (endDate) {
                query[dateField].$lte = new Date(endDate);
            }
        }

        if (category) query.category = category;
        if (employee) query.employee = employee;

        const skip = (page - 1) * limit;

        // Base query
        let expenseQuery = Expense.find(query)
            .populate(
                'employee',
                'firstName lastName email department designation fullName daysToAnniversary'
            )
            .populate('category', 'name description maxAmount')
            .populate('approvedBy', 'name email')
            .populate('rejectedBy', 'name email')
            .sort(sortBy)
            .skip(skip)
            .limit(parseInt(limit));

        // Execute query
        let expenses = await expenseQuery;

        // Apply department filter after population
        if (department) {
            expenses = expenses.filter(expense =>
                expense.employee &&
                expense.employee.department === department
            );
        }

        // Apply search filter
        if (search) {
            const searchLower = search.toLowerCase();
            expenses = expenses.filter(expense => {
                return (
                    expense.description.toLowerCase().includes(searchLower) ||
                    expense.employee.name.toLowerCase().includes(searchLower) ||
                    expense.employee.email.toLowerCase().includes(searchLower)
                );
            });
        }

        res.json({
            success: true,
            count: expenses.length,
            data: expenses,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        next(error);
    }
};

// HR: GET EXPENSES BY STATUS
exports.getExpensesByStatus = async (req, res, next) => {
    try {
        const {
            startDate,
            endDate,
            department,
            page = 1,
            limit = 50
        } = req.query;

        const status = req.params.status;
        const query = { status };

        // Date range filter
        if (startDate || endDate) {
            const dateField = status === 'submitted' ? 'submittedAt' : 'createdAt';
            query[dateField] = {};

            if (startDate) query[dateField].$gte = new Date(startDate);
            if (endDate) query[dateField].$lte = new Date(endDate);
        }

        const skip = (page - 1) * limit;

        let expenses = await Expense.find(query)
            .populate(
                'employee',
                'firstName lastName email department designation fullName daysToAnniversary'
            )
            .populate('category', 'name')
            .sort('-createdAt')
            .skip(skip)
            .limit(parseInt(limit));

        // Apply department filter
        if (department) {
            expenses = expenses.filter(expense =>
                expense.employee &&
                expense.employee.department === department
            );
        }

        res.json({
            success: true,
            count: expenses.length,
            data: expenses
        });
    } catch (error) {
        next(error);
    }
};

// HR: GET EXPENSE STATISTICS
exports.getExpenseStats = async (req, res, next) => {
    try {
        const { startDate, endDate, department } = req.query;

        const matchStage = { status: { $ne: 'draft' } };

        // Date filter
        if (startDate || endDate) {
            matchStage.createdAt = {};
            if (startDate) matchStage.createdAt.$gte = new Date(startDate);
            if (endDate) matchStage.createdAt.$lte = new Date(endDate);
        }

        const aggregation = await Expense.aggregate([
            { $match: matchStage },
            {
                $lookup: {
                    from: 'users',
                    localField: 'employee',
                    foreignField: '_id',
                    as: 'employee'
                }
            },
            { $unwind: '$employee' },
            {
                $group: {
                    _id: null,
                    totalExpenses: { $sum: 1 },
                    totalAmount: { $sum: '$amount' },
                    avgAmount: { $avg: '$amount' },
                    maxAmount: { $max: '$amount' },
                    minAmount: { $min: '$amount' },
                    byStatus: {
                        $push: {
                            status: '$status',
                            amount: '$amount'
                        }
                    },
                    byDepartment: {
                        $push: {
                            department: '$employee.department',
                            amount: '$amount'
                        }
                    }
                }
            }
        ]);

        const stats = aggregation[0] || {
            totalExpenses: 0,
            totalAmount: 0,
            avgAmount: 0,
            maxAmount: 0,
            minAmount: 0,
            byStatus: [],
            byDepartment: []
        };

        // Process status data
        const statusStats = {};
        stats.byStatus.forEach(item => {
            if (!statusStats[item.status]) {
                statusStats[item.status] = { count: 0, amount: 0 };
            }
            statusStats[item.status].count += 1;
            statusStats[item.status].amount += item.amount;
        });

        // Process department data
        const deptStats = {};
        stats.byDepartment.forEach(item => {
            if (!deptStats[item.department]) {
                deptStats[item.department] = { count: 0, amount: 0 };
            }
            deptStats[item.department].count += 1;
            deptStats[item.department].amount += item.amount;
        });

        // Get monthly trend
        const monthlyTrend = await Expense.aggregate([
            { $match: matchStage },
            {
                $group: {
                    _id: {
                        year: { $year: '$createdAt' },
                        month: { $month: '$createdAt' }
                    },
                    count: { $sum: 1 },
                    totalAmount: { $sum: '$amount' },
                    avgAmount: { $avg: '$amount' }
                }
            },
            { $sort: { '_id.year': 1, '_id.month': 1 } },
            {
                $project: {
                    _id: 0,
                    period: {
                        $concat: [
                            { $toString: '$_id.year' },
                            '-',
                            { $toString: '$_id.month' }
                        ]
                    },
                    count: 1,
                    totalAmount: 1,
                    avgAmount: 1
                }
            }
        ]);

        const result = {
            summary: {
                totalExpenses: stats.totalExpenses,
                totalAmount: stats.totalAmount,
                averageAmount: stats.avgAmount,
                maxAmount: stats.maxAmount,
                minAmount: stats.minAmount
            },
            byStatus: statusStats,
            byDepartment: deptStats,
            monthlyTrend: monthlyTrend
        };

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        next(error);
    }
};

// HR: GET EXPENSE DETAIL (with full access)
exports.getExpenseDetailForHR = async (req, res, next) => {
    try {
        const expense = await Expense.findById(req.params.id)
            .populate('employee', 'name email department designation employeeId')
            .populate('category', 'name description maxAmount requiresApproval')
            .populate('approvedBy', 'name email role')
            .populate('rejectedBy', 'name email role');

        if (!expense) {
            throw new AppError('Expense not found', 404);
        }

        res.json({
            success: true,
            data: expense
        });
    } catch (error) {
        next(error);
    }
};

// HR: BULK ACTIONS
exports.bulkApproveExpenses = async (req, res, next) => {
    try {
        const { expenseIds, comments } = req.body;
        const hrUserId = req.user.id;

        if (!expenseIds || !Array.isArray(expenseIds)) {
            throw new AppError('Invalid expense IDs', 400);
        }

        const results = [];

        for (const expenseId of expenseIds) {
            try {
                const expense = await Expense.findById(expenseId)
                    .populate('employee', 'name email');

                if (!expense) {
                    results.push({
                        expenseId,
                        success: false,
                        error: 'Expense not found'
                    });
                    continue;
                }

                if (expense.status !== 'submitted') {
                    results.push({
                        expenseId,
                        success: false,
                        error: `Expense is '${expense.status}', cannot process`
                    });
                    continue;
                }

                expense.status = 'approved';
                expense.approvedBy = hrUserId;
                expense.approvedAt = new Date();
                expense.approvalComments = comments;
                await expense.save();

                results.push({
                    expenseId,
                    success: true,
                    data: expense
                });
            } catch (error) {
                results.push({
                    expenseId,
                    success: false,
                    error: error.message
                });
            }
        }

        res.json({
            success: true,
            data: results,
            message: 'Bulk approval completed'
        });
    } catch (error) {
        next(error);
    }
};

// HR: EXPORT EXPENSES
exports.exportExpenses = async (req, res, next) => {
    try {
        // Get expenses with same filters as getAllExpensesForHR
        const expenses = await Expense.find({ status: { $ne: 'draft' } })
            .populate('employee', 'name email department designation employeeId')
            .populate('category', 'name')
            .populate('approvedBy', 'name')
            .populate('rejectedBy', 'name')
            .sort('-createdAt');

        // Convert to export format
        const exportData = expenses.map(expense => ({
            'Expense ID': expense._id,
            'Employee Name': expense.employee?.name || 'N/A',
            'Employee Email': expense.employee?.email || 'N/A',
            'Department': expense.employee?.department || 'N/A',
            'Amount': expense.amount,
            'Description': expense.description,
            'Category': expense.category?.name || 'N/A',
            'Status': expense.status,
            'Date': expense.date.toISOString().split('T')[0],
            'Submitted At': expense.submittedAt?.toISOString().split('T')[0] || 'N/A',
            'Approved/Rejected By': expense.approvedBy?.name || expense.rejectedBy?.name || 'N/A',
            'Approval Comments': expense.approvalComments || expense.rejectionReason || 'N/A'
        }));

        res.json({
            success: true,
            data: exportData,
            message: 'Export data prepared'
        });
    } catch (error) {
        next(error);
    }
};

// Alias functions for specific statuses
exports.getPendingExpenses = async (req, res, next) => {
    req.params = { status: 'submitted' };
    return exports.getExpensesByStatus(req, res, next);
};

exports.getApprovedExpenses = async (req, res, next) => {
    req.params = { status: 'approved' };
    return exports.getExpensesByStatus(req, res, next);
};

exports.getRejectedExpenses = async (req, res, next) => {
    req.params = { status: 'rejected' };
    return exports.getExpensesByStatus(req, res, next);
};

// Helper function for department expenses
exports.getDepartmentExpenses = async (req, res, next) => {
    try {
        const { department, startDate, endDate } = req.query;

        const query = {};

        if (department) {
            // Get all expenses and filter by department after population
            const expenses = await Expense.find(query)
                .populate('employee', 'name email department designation employeeId')
                .populate('category', 'name')
                .sort('-createdAt');

            const filteredExpenses = expenses.filter(expense =>
                expense.employee &&
                expense.employee.department === department
            );

            res.json({
                success: true,
                count: filteredExpenses.length,
                data: filteredExpenses
            });
        } else {
            // Return all expenses grouped by department
            const expenses = await Expense.find(query)
                .populate('employee', 'name email department designation employeeId')
                .populate('category', 'name')
                .sort('-createdAt');

            res.json({
                success: true,
                count: expenses.length,
                data: expenses
            });
        }
    } catch (error) {
        next(error);
    }
};