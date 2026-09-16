require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

// Services & Utils
const connectDB = require('./config/db');
const errorHandler = require('./middleware/errorHandler');
const cronJobs = require('./utils/cronJobs');
const emailService = require('./utils/emailService');
const createSuperAdmin = require('../seedAdmin');
const { initSocket } = require('./socket');

// Firebase Admin
const admin = require('../src/firebase/firebase');


// Routes
const authRoutes = require('./routes/authRoutes');
const employeeRoutes = require('./routes/employeeRoutes');
const attendanceRoutes = require('./routes/attendanceRoutes');
const leaveRoutes = require('./routes/leaveRoutes');
const payrollRoutes = require('./routes/payrollRoutes');
const departmentRoutes = require('./routes/departmentRoutes');
const announcementRoutes = require('./routes/announcementRoutes');
const assetRoutes = require('./routes/assetRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const holidayRoutes = require('./routes/holidayRoutes');
const celebrationRoutes = require('./routes/celebrationRoutes');
const chatRoutes = require('./routes/chatRoutes');
const feedbackRoutes = require('./routes/feedbackRoutes');
const pollRoutes = require('./routes/pollRoutes');
const awardRoutes = require('./routes/awardRoutes');
const badgeRoutes = require('./routes/badgeRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const cronTestRoutes = require('./routes/cronTestRoutes');
const comboOffRoutes = require('./routes/comboOffRoutes');
const faqRoutes = require('./routes/faqRoutes');
const helpRoutes = require('./routes/helpRoutes');
const ticketRoutes = require('./routes/ticketRoutes');
const aboutRoutes = require('./routes/aboutRoutes');
const emailRoutes = require('./routes/emailRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const taskRoutes = require('./routes/taskRoutes');
const systemRoutes = require('./routes/systemRoutes');
const expenseRoutes = require('./routes/expenseRoutes');
const expenseCategoryRoutes = require('./routes/expenseCategoryRoutes');
const projectRoutes = require('./routes/projectRoutes');
const roleRoutes = require('./routes/roleRoutes');
const tokenRoutes = require('./routes/tokenRoutes');
const debugRoutes = require('./routes/debugRoutes');
const dailyTaskRoutes = require('./routes/dailyTaskRoutes');
const callRoutes = require('./routes/callRoutes');
const employeeInteractionRoutes = require('./routes/employeeInteractionRoutes');
// const face = require('./routes/faceRecognitionRoutes');
const rfidRoutes = require('./routes/rfidRoutes'); // RFID routes
const numberPlateRoutes = require('./routes/numberPlateRoutes');
const geoFenceRoutes = require('./routes/geoFence');
const geocodeRoutes = require("./routes/geocode");
const faceRoutes = require('./routes/faceRoutes');

// Initialize Express app
const app = express();
const server = http.createServer(app);

// Security & Middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "form-action": ["'self'"],
        "script-src": ["'self'", "'unsafe-inline'"],
      },
    },
  })
);


const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  "http://localhost:5173", // Vite
  "http://localhost:8080",
  process.env.CLIENT_URL
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      callback(new Error("Not allowed by CORS"));
    },
    credentials: true
  })
);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Password Reset Page Route
app.get('/reset-password/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'email', 'reset-password.html'));
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/leaves', leaveRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/assets', assetRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/holidays', holidayRoutes);
app.use('/api/celebrations', celebrationRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/feedbacks', feedbackRoutes);
app.use('/api/polls', pollRoutes);
app.use('/api/awards', awardRoutes);
app.use('/api/badges', badgeRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/cron', cronTestRoutes);
app.use('/api/combooff', comboOffRoutes);
app.use('/api/faqs', faqRoutes);
app.use('/api/help-topics', helpRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/about', aboutRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/expense-categories', expenseCategoryRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/project-roles', roleRoutes);
app.use('/api/tokens', tokenRoutes);
app.use('/api/debug', debugRoutes);
app.use('/api/daily-tasks', dailyTaskRoutes);
app.use('/api/calls', callRoutes);  // Add call routes
app.use('/api/employee-interactions', employeeInteractionRoutes);
// app.use('/api/face', face); // Face recognition routes
app.use('/api/rfid-scans', rfidRoutes); // RFID scan routes
app.use('/api/plate', numberPlateRoutes);
app.use('/api/geo-fence', geoFenceRoutes);
app.use("/api/geocode", geocodeRoutes); // Geocode routes
app.use('/api/face', faceRoutes);

// Add a debug endpoint
app.get('/api/debug/socket-status', (req, res) => {
  try {
    const { getIo, getOnlineUsers } = require('./socket/chat');
    const io = getIo();

    if (!io) {
      return res.json({
        success: false,
        message: 'Socket.IO not initialized',
        status: 'io_not_initialized'
      });
    }

    const onlineUsers = getOnlineUsers ? getOnlineUsers() : [];
    const sockets = io.sockets ? Array.from(io.sockets.sockets.keys()) : [];

    res.json({
      success: true,
      status: 'running',
      ioInitialized: !!io,
      connectedSockets: sockets.length,
      onlineUsersCount: onlineUsers.length,
      onlineUsers: onlineUsers,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Test connection endpoint
app.get('/api/test-connection', (req, res) => {
  res.json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    socketEnabled: true
  });
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// Error Handler
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

// Connection monitoring middleware
app.use((req, res, next) => {
  console.log(`🌐 [${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});


// Start server after MongoDB connection
connectDB()
  .then(async () => {
    console.log('✅ MongoDB connected successfully');

    // Initialize services
    await cronJobs.startCronJobs();
    await createSuperAdmin();

    // Verify email service
    try {
      await emailService.verifyEmailConfig();
      console.log('✅ Email service initialized successfully');
    } catch (error) {
      console.error('❌ Email service initialization failed:', error.message);
      console.warn('⚠️  Server will continue but emails may not work');
      console.warn('⚠️  Please check your .env email configuration');
    }

    // Initialize Socket.IO
    const io = initSocket(server);

    // Monitor socket connections
    io.engine.on("connection_error", (err) => {
      console.error('🔥 Socket.IO connection error:', {
        code: err.code,
        message: err.message,
        context: err.context
      });
    });

    // Test Firebase Admin (optional)
    try {
      const bucket = admin.storage().bucket();
      console.log(`✅ Firebase bucket initialized: ${bucket.name}`);
    } catch (err) {
      console.error('❌ Firebase initialization failed:', err.message);
    }

    // Start server
    server.listen(PORT, () => {
      console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                    HRMS Server Started                        ║
╠═══════════════════════════════════════════════════════════════╣
║ Environment : ${process.env.NODE_ENV || 'development'}        ║
║ Port        : ${PORT}                                         ║
║ API         : http://localhost:${PORT}/api                    ║
║ Socket      : ws://localhost:${PORT}                          ║
║ Debug       : http://localhost:${PORT}/api/debug/socket-status║
║ Test        : http://localhost:${PORT}/api/test-connection    ║
║ Reset Page  : http://localhost:${PORT}/reset-password/:token  ║
║ Email       : ${process.env.EMAIL_HOST || 'Not Configured'}   ║
╚═══════════════════════════════════════════════════════════════╝
`);
    });
  })
  .catch((err) => {
    console.error('❌ Failed to connect to MongoDB:', err);
    process.exit(1);
  });

// Graceful shutdown
process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled Rejection:', err.message);
  server.close(() => process.exit(1));
});

process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('✅ Process terminated');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  server.close(() => {
    console.log('✅ Process terminated');
    process.exit(0);
  });
});