const { Server } = require('socket.io');
const { initChat } = require('./chat');
const { initCallSocket } = require('./webrtc');

let io = null;

/**
 * Initialize Socket.IO server (singleton pattern)
 * @param {http.Server} httpServer - The HTTP server instance
 * @returns {Server} Socket.IO server instance
 */
function initSocket(httpServer) {
  // Prevent multiple initializations
  if (io) {
    console.log('Socket.IO already initialized');
    return io;
  }

  if (!httpServer) {
    throw new Error('httpServer instance is required to initialize Socket.IO');
  }

  console.log('🚀 Initializing Socket.IO server...');

  io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        // Allow all in development
        if (process.env.NODE_ENV !== 'production') {
          return callback(null, true);
        }
        const allowedOrigins = [
          process.env.CLIENT_URL,
          'http://localhost:3000',
          'http://localhost:3001',
          'http://127.0.0.1:3000',
          'http://127.0.0.1:3001',
        ].filter(Boolean);
        if (!origin || allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        console.log('❌ CORS blocked origin:', origin);
        callback(new Error('Not allowed by CORS'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type', 'X-Requested-With']
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000,
    connectTimeout: 45000,
    maxHttpBufferSize: 1e8,
    // For production:
    // cookie: false,
    // serveClient: false,
    // path: '/socket.io/',
    allowEIO3: true // For compatibility with older clients
  });

  console.log('✅ Socket.IO server initialized');

  // Initialize feature handlers
  try {
    // Initialize chat on main namespace
    initChat(io);
    console.log('✅ Chat socket handler initialized');

    // Initialize calls on separate namespace
    const callNamespace = initCallSocket(io);
    console.log('✅ Call socket handler initialized on namespace:', callNamespace.name);

    // Global connection logging for debugging
    io.engine.on('connection', (rawSocket) => {
      console.log('🔌 Raw engine connection:', rawSocket.id);
    });

    // Global error handling
    io.on('connection_error', (err) => {
      console.error('💥 Connection error:', err);
    });

  } catch (error) {
    console.error('❌ Failed to initialize socket handlers:', error);
    throw error;
  }

  // Add global middleware for all namespaces
  io.use((socket, next) => {
    console.log('🌐 Global middleware for socket:', socket.id, 'namespace:', socket.nsp.name);
    next();
  });

  return io;
}

/**
 * Get the active Socket.IO instance
 * @throws {Error} If Socket.IO hasn't been initialized yet
 */
function getIo() {
  if (!io) {
    throw new Error(
      'Socket.IO not initialized yet. ' +
      'You must call initSocket(httpServer) first (usually in your server.js/app.js)'
    );
  }
  return io;
}

module.exports = {
  initSocket,
  getIo,
  // Helper to get call namespace
  getCallNamespace: () => io?.of('/call')
};