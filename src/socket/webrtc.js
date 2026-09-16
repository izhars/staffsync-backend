const jwt = require('jsonwebtoken');
const User = require('../models/User');
const activeCalls = new Map();
const peerConnections = new Map(); 
const userCallStatus = new Map();

// Room management
const activeRooms = new Map();

let callNamespace = null;

/**
 * Initialize WebRTC/Call socket namespace
 * @param {Server} io - Socket.IO server instance
 * @returns {Namespace} Call namespace instance
 */
function initCallSocket(io) {
  console.log('🔊 Initializing Call Socket Handler...');
  
  // Create separate namespace for calls
  callNamespace = io.of('/call');
  
  if (!callNamespace) {
    throw new Error('Failed to create call namespace');
  }
  
  console.log('📞 Call namespace created:', callNamespace.name);

  // Authentication middleware for call namespace
  callNamespace.use(async (socket, next) => {
    const token = socket.handshake.auth?.token || 
                  socket.handshake.query?.token ||
                  socket.handshake.headers?.authorization?.replace('Bearer ', '');

    console.log(`📞 Token for call socket: ${token ? 'Present' : 'Missing'}`);

    if (!token) {
      console.log('❌ No token provided for call socket');
      return next(new Error('Authentication required for calls. No token provided.'));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id)
        .select('firstName lastName role employeeId email profilePicture department status');

      if (!user) {
        console.log('❌ User not found for call socket');
        return next(new Error('Authentication error: User not found'));
      }

      // Check if user is active
      if (user.status !== 'active') {
        return next(new Error('User account is not active'));
      }

      // Attach user to socket
      socket.user = {
        id: user._id.toString(),
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: `${user.firstName} ${user.lastName}`.trim(),
        role: user.role,
        employeeId: user.employeeId,
        email: user.email,
        avatar: user.profilePicture?.url || '/default-avatar.png',
        department: user.department
      };

      console.log(`✅ Call socket authenticated: ${socket.user.fullName} (${socket.user.id})`);
      next();
    } catch (err) {
      console.error('❌ Call socket auth error:', err.message);
      next(new Error('Authentication error: ' + err.message));
    }
  });

  // Call namespace connection handler
  callNamespace.on('connection', (socket) => {
    const { id, fullName, email } = socket.user;
    const userId = id.toString();

    console.log(`✅ Call socket connected: ${fullName} (${userId})`, {
      socketId: socket.id,
      email,
      callConnections: callNamespace.sockets.size
    });

    // Join user's personal room for direct messaging
    socket.join(`user:${userId}`);
    
    // Update user call status
    userCallStatus.set(userId, {
      inCall: false,
      currentCallId: null,
      socketId: socket.id,
      connectedAt: new Date(),
      currentRoom: null
    });

    // Store socket reference for easy lookup
    socket.userId = userId;

    // ==================== ROOM-BASED EVENTS (For manual room joining) ====================

    /**
     * Create or join a room
     */
    socket.on('create-room', (data) => {
      try {
        const { roomId, metadata = {} } = data;
        
        if (!roomId || roomId.trim() === '') {
          return socket.emit('room-error', {
            type: 'INVALID_ROOM_ID',
            message: 'Room ID is required',
            timestamp: new Date().toISOString()
          });
        }

        console.log(`🏠 ${fullName} creating/joining room: ${roomId}`);

        // Check if already in a room
        if (socket.currentRoom && socket.currentRoom !== roomId) {
          // Leave previous room
          socket.leave(socket.currentRoom);
          
          // Notify old room participants
          socket.to(socket.currentRoom).emit('user-left', {
            roomId: socket.currentRoom,
            userId,
            userName: fullName,
            reason: 'switched rooms',
            timestamp: new Date().toISOString()
          });
        }

        // Join the new room
        socket.join(roomId);
        socket.currentRoom = roomId;

        // Update user status
        const userStatus = userCallStatus.get(userId);
        if (userStatus) {
          userStatus.currentRoom = roomId;
          userCallStatus.set(userId, userStatus);
        }

        // Initialize or update room data
        if (!activeRooms.has(roomId)) {
          activeRooms.set(roomId, {
            id: roomId,
            creatorId: userId,
            creatorName: fullName,
            participants: [{
              userId,
              socketId: socket.id,
              joinedAt: new Date(),
              userInfo: socket.user
            }],
            metadata: {
              ...metadata,
              createdAt: new Date().toISOString(),
              roomType: 'manual',
              maxParticipants: 10
            },
            isLocked: false
          });
        } else {
          const room = activeRooms.get(roomId);
          // Check if user already in room
          if (!room.participants.some(p => p.userId === userId)) {
            room.participants.push({
              userId,
              socketId: socket.id,
              joinedAt: new Date(),
              userInfo: socket.user
            });
            activeRooms.set(roomId, room);
          }
        }

        // Get room participants
        const room = activeRooms.get(roomId);
        const participants = room?.participants || [];

        // Notify user
        socket.emit('room-created', {
          roomId,
          userId,
          socketId: socket.id,
          participants: participants.map(p => ({
            userId: p.userId,
            socketId: p.socketId,
            userName: p.userInfo?.fullName || 'Unknown',
            avatar: p.userInfo?.avatar,
            joinedAt: p.joinedAt
          })),
          metadata: room?.metadata,
          timestamp: new Date().toISOString()
        });

        console.log(`🏠 ${fullName} joined room ${roomId} with ${participants.length} participants`);

        // Notify other participants in the room
        socket.to(roomId).emit('user-joined', {
          roomId,
          userId,
          userName: fullName,
          avatar: socket.user.avatar,
          socketId: socket.id,
          participantsCount: participants.length,
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        console.error('❌ Error creating/joining room:', error);
        socket.emit('room-error', {
          type: 'ROOM_CREATION_FAILED',
          message: 'Failed to create/join room',
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });

    /**
     * Join an existing room
     */
    socket.on('join-room', (data) => {
      try {
        const { roomId } = data;
        
        if (!roomId) {
          return socket.emit('room-error', {
            type: 'ROOM_ID_REQUIRED',
            message: 'Room ID is required',
            timestamp: new Date().toISOString()
          });
        }

        console.log(`🚪 ${fullName} joining room: ${roomId}`);

        // Check if room exists
        const room = activeRooms.get(roomId);
        if (!room) {
          return socket.emit('room-error', {
            type: 'ROOM_NOT_FOUND',
            message: 'Room does not exist',
            roomId,
            timestamp: new Date().toISOString()
          });
        }

        // Check if room is locked
        if (room.isLocked) {
          return socket.emit('room-error', {
            type: 'ROOM_LOCKED',
            message: 'Room is locked',
            roomId,
            timestamp: new Date().toISOString()
          });
        }

        // Check max participants
        if (room.participants.length >= (room.metadata.maxParticipants || 10)) {
          return socket.emit('room-error', {
            type: 'ROOM_FULL',
            message: 'Room is full',
            roomId,
            maxParticipants: room.metadata.maxParticipants,
            timestamp: new Date().toISOString()
          });
        }

        // Check if already in this room
        if (room.participants.some(p => p.userId === userId)) {
          return socket.emit('room-error', {
            type: 'ALREADY_IN_ROOM',
            message: 'You are already in this room',
            roomId,
            timestamp: new Date().toISOString()
          });
        }

        // Leave current room if different
        if (socket.currentRoom && socket.currentRoom !== roomId) {
          socket.leave(socket.currentRoom);
          socket.to(socket.currentRoom).emit('user-left', {
            roomId: socket.currentRoom,
            userId,
            userName: fullName,
            reason: 'joining new room',
            timestamp: new Date().toISOString()
          });
        }

        // Join the room
        socket.join(roomId);
        socket.currentRoom = roomId;

        // Update user status
        const userStatus = userCallStatus.get(userId);
        if (userStatus) {
          userStatus.currentRoom = roomId;
          userCallStatus.set(userId, userStatus);
        }

        // Add user to room participants
        room.participants.push({
          userId,
          socketId: socket.id,
          joinedAt: new Date(),
          userInfo: socket.user
        });
        activeRooms.set(roomId, room);

        // Get all participants
        const participants = room.participants;

        // Notify joiner
        socket.emit('joined-room', {
          roomId,
          userId,
          socketId: socket.id,
          participants: participants.map(p => ({
            userId: p.userId,
            socketId: p.socketId,
            userName: p.userInfo?.fullName || 'Unknown',
            avatar: p.userInfo?.avatar,
            joinedAt: p.joinedAt
          })),
          metadata: room.metadata,
          timestamp: new Date().toISOString()
        });

        // Notify other participants
        socket.to(roomId).emit('user-joined', {
          roomId,
          userId,
          userName: fullName,
          avatar: socket.user.avatar,
          socketId: socket.id,
          participantsCount: participants.length,
          timestamp: new Date().toISOString()
        });

        console.log(`🚪 ${fullName} joined room ${roomId}. Total participants: ${participants.length}`);

      } catch (error) {
        console.error('❌ Error joining room:', error);
        socket.emit('room-error', {
          type: 'ROOM_JOIN_FAILED',
          message: 'Failed to join room',
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });

    /**
     * Leave a room
     */
    socket.on('leave-room', (data) => {
      try {
        const { roomId, reason = 'User left' } = data || {};
        const targetRoomId = roomId || socket.currentRoom;

        if (!targetRoomId) {
          return socket.emit('room-error', {
            type: 'NO_CURRENT_ROOM',
            message: 'Not currently in any room',
            timestamp: new Date().toISOString()
          });
        }

        console.log(`🚶 ${fullName} leaving room: ${targetRoomId}`);

        // Leave the room
        socket.leave(targetRoomId);

        // Update user status
        const userStatus = userCallStatus.get(userId);
        if (userStatus) {
          userStatus.currentRoom = null;
          userCallStatus.set(userId, userStatus);
        }

        // Remove from room participants
        const room = activeRooms.get(targetRoomId);
        if (room) {
          room.participants = room.participants.filter(p => p.userId !== userId);
          
          if (room.participants.length === 0) {
            // Delete empty room
            activeRooms.delete(targetRoomId);
            console.log(`🗑️ Room ${targetRoomId} deleted (empty)`);
          } else {
            activeRooms.set(targetRoomId, room);
          }
        }

        // Clear current room
        socket.currentRoom = null;

        // Notify other participants
        socket.to(targetRoomId).emit('user-left', {
          roomId: targetRoomId,
          userId,
          userName: fullName,
          reason,
          timestamp: new Date().toISOString()
        });

        // Confirm to user
        socket.emit('left-room', {
          roomId: targetRoomId,
          userId,
          reason,
          timestamp: new Date().toISOString()
        });

        console.log(`🚶 ${fullName} left room ${targetRoomId}`);

      } catch (error) {
        console.error('❌ Error leaving room:', error);
        socket.emit('room-error', {
          type: 'ROOM_LEAVE_FAILED',
          message: 'Failed to leave room',
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });

    /**
     * Get room info
     */
    socket.on('get-room-info', (data) => {
      try {
        const { roomId } = data;
        const targetRoomId = roomId || socket.currentRoom;

        if (!targetRoomId) {
          return socket.emit('room-error', {
            type: 'NO_ROOM_SPECIFIED',
            message: 'No room specified',
            timestamp: new Date().toISOString()
          });
        }

        const room = activeRooms.get(targetRoomId);
        if (!room) {
          return socket.emit('room-error', {
            type: 'ROOM_NOT_FOUND',
            message: 'Room not found',
            roomId: targetRoomId,
            timestamp: new Date().toISOString()
          });
        }

        socket.emit('room-info', {
          roomId: targetRoomId,
          participants: room.participants.map(p => ({
            userId: p.userId,
            socketId: p.socketId,
            userName: p.userInfo?.fullName || 'Unknown',
            avatar: p.userInfo?.avatar,
            joinedAt: p.joinedAt
          })),
          metadata: room.metadata,
          participantsCount: room.participants.length,
          isLocked: room.isLocked,
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        console.error('❌ Error getting room info:', error);
        socket.emit('room-error', {
          type: 'ROOM_INFO_FAILED',
          message: 'Failed to get room info',
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });

    /**
     * Lock/unlock room
     */
    socket.on('toggle-room-lock', (data) => {
      try {
        const { roomId, locked } = data;
        const targetRoomId = roomId || socket.currentRoom;

        if (!targetRoomId) {
          return socket.emit('room-error', {
            type: 'NO_CURRENT_ROOM',
            message: 'Not currently in any room',
            timestamp: new Date().toISOString()
          });
        }

        const room = activeRooms.get(targetRoomId);
        if (!room) {
          return socket.emit('room-error', {
            type: 'ROOM_NOT_FOUND',
            message: 'Room not found',
            roomId: targetRoomId,
            timestamp: new Date().toISOString()
          });
        }

        // Check if user is the creator
        if (room.creatorId !== userId) {
          return socket.emit('room-error', {
            type: 'NOT_AUTHORIZED',
            message: 'Only room creator can lock/unlock room',
            timestamp: new Date().toISOString()
          });
        }

        room.isLocked = locked !== undefined ? locked : !room.isLocked;
        activeRooms.set(targetRoomId, room);

        // Notify all room participants
        callNamespace.to(targetRoomId).emit('room-lock-changed', {
          roomId: targetRoomId,
          locked: room.isLocked,
          changedBy: userId,
          changedByName: fullName,
          timestamp: new Date().toISOString()
        });

        console.log(`🔒 Room ${targetRoomId} ${room.isLocked ? 'locked' : 'unlocked'} by ${fullName}`);

      } catch (error) {
        console.error('❌ Error toggling room lock:', error);
        socket.emit('room-error', {
          type: 'ROOM_LOCK_FAILED',
          message: 'Failed to toggle room lock',
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });

    // ==================== WEBRTC SIGNALING IN ROOMS ====================

    /**
     * Send WebRTC offer to room participants
     */
    socket.on('offer', (data) => {
      try {
        const { roomId, offer, targetSocketId } = data;
        console.log(`📡 ${fullName} sending offer in room ${roomId} to ${targetSocketId || 'all'}`);

        // Validate room membership
        if (!socket.rooms.has(roomId)) {
          return socket.emit('room-error', {
            type: 'NOT_IN_ROOM',
            message: 'Not a member of this room',
            roomId,
            timestamp: new Date().toISOString()
          });
        }

        const offerData = {
          roomId,
          offer,
          fromUserId: userId,
          fromSocketId: socket.id,
          fromUserName: fullName,
          timestamp: new Date().toISOString()
        };

        if (targetSocketId) {
          // Send to specific user
          callNamespace.to(targetSocketId).emit('offer', offerData);
        } else {
          // Send to all other participants in room
          socket.to(roomId).emit('offer', offerData);
        }

      } catch (error) {
        console.error('❌ Error sending offer:', error);
        socket.emit('room-error', {
          type: 'OFFER_FAILED',
          message: 'Failed to send offer',
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });

    /**
     * Send WebRTC answer to room participants
     */
    socket.on('answer', (data) => {
      try {
        const { roomId, answer, targetSocketId } = data;
        console.log(`📡 ${fullName} sending answer in room ${roomId}`);

        if (!socket.rooms.has(roomId)) {
          return socket.emit('room-error', {
            type: 'NOT_IN_ROOM',
            message: 'Not a member of this room',
            roomId,
            timestamp: new Date().toISOString()
          });
        }

        const answerData = {
          roomId,
          answer,
          fromUserId: userId,
          fromSocketId: socket.id,
          fromUserName: fullName,
          timestamp: new Date().toISOString()
        };

        if (targetSocketId) {
          callNamespace.to(targetSocketId).emit('answer', answerData);
        } else {
          socket.to(roomId).emit('answer', answerData);
        }

      } catch (error) {
        console.error('❌ Error sending answer:', error);
        socket.emit('room-error', {
          type: 'ANSWER_FAILED',
          message: 'Failed to send answer',
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });

    /**
     * Send ICE candidate to room participants
     */
    socket.on('ice-candidate', (data) => {
      try {
        const { roomId, candidate, targetSocketId } = data;

        if (!socket.rooms.has(roomId)) {
          return socket.emit('room-error', {
            type: 'NOT_IN_ROOM',
            message: 'Not a member of this room',
            roomId,
            timestamp: new Date().toISOString()
          });
        }

        const candidateData = {
          roomId,
          candidate,
          fromUserId: userId,
          fromSocketId: socket.id,
          fromUserName: fullName,
          timestamp: new Date().toISOString()
        };

        if (targetSocketId) {
          callNamespace.to(targetSocketId).emit('ice-candidate', candidateData);
        } else {
          socket.to(roomId).emit('ice-candidate', candidateData);
        }

      } catch (error) {
        console.error('❌ Error sending ICE candidate:', error);
        socket.emit('room-error', {
          type: 'ICE_CANDIDATE_FAILED',
          message: 'Failed to send ICE candidate',
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });

    /**
     * Get all participants in a room
     */
    socket.on('get-room-participants', (data) => {
      try {
        const { roomId } = data;
        const targetRoomId = roomId || socket.currentRoom;

        if (!targetRoomId) {
          return socket.emit('room-error', {
            type: 'NO_ROOM_SPECIFIED',
            message: 'No room specified',
            timestamp: new Date().toISOString()
          });
        }

        const room = activeRooms.get(targetRoomId);
        if (!room) {
          return socket.emit('room-error', {
            type: 'ROOM_NOT_FOUND',
            message: 'Room not found',
            roomId: targetRoomId,
            timestamp: new Date().toISOString()
          });
        }

        socket.emit('room-participants', {
          roomId: targetRoomId,
          participants: room.participants.map(p => ({
            userId: p.userId,
            socketId: p.socketId,
            userName: p.userInfo?.fullName || 'Unknown',
            avatar: p.userInfo?.avatar,
            joinedAt: p.joinedAt,
            isOnline: true
          })),
          count: room.participants.length,
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        console.error('❌ Error getting room participants:', error);
        socket.emit('room-error', {
          type: 'ROOM_PARTICIPANTS_FAILED',
          message: 'Failed to get room participants',
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });

    // ==================== CALL EVENTS (Existing call system) ====================

    /**
     * Create a new call
     */
    socket.on('create-call', (data) => {
      try {
        const { callType = 'audio', targetUserId, metadata = {} } = data;
        
        console.log(`📞 ${fullName} creating ${callType} call to ${targetUserId}`);

        // Check if target user is online (has active call socket)
        const targetStatus = userCallStatus.get(targetUserId);
        if (!targetStatus) {
          return socket.emit('call-error', {
            type: 'TARGET_OFFLINE',
            message: 'User is not connected to call server',
            targetUserId,
            timestamp: new Date().toISOString()
          });
        }

        // Check if target is already in a call
        if (targetStatus.inCall) {
          return socket.emit('call-error', {
            type: 'TARGET_BUSY',
            message: 'User is already in a call',
            targetUserId,
            currentCallId: targetStatus.currentCallId,
            timestamp: new Date().toISOString()
          });
        }

        // Generate unique call ID
        const callId = `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Create call object
        const call = {
          id: callId,
          creatorId: userId,
          creatorName: fullName,
          targetUserId,
          callType,
          status: 'initiating',
          participants: [
            {
              userId,
              socketId: socket.id,
              joinedAt: new Date(),
              role: 'caller',
              userInfo: socket.user
            }
          ],
          metadata: {
            ...metadata,
            createdAt: new Date().toISOString()
          },
          startTime: null,
          endTime: null,
          isGroupCall: false
        };

        // Store call
        activeCalls.set(callId, call);

        // Update user status
        userCallStatus.set(userId, {
          ...userCallStatus.get(userId),
          inCall: true,
          currentCallId: callId
        });

        // Emit call created event to caller
        socket.emit('call-created', {
          callId,
          callType,
          targetUserId,
          timestamp: new Date().toISOString()
        });

        // Send call invitation to target user
        callNamespace.to(`user:${targetUserId}`).emit('call-incoming', {
          callId,
          callerId: userId,
          callerName: fullName,
          callerAvatar: socket.user.avatar,
          callType,
          timestamp: new Date().toISOString(),
          metadata: call.metadata
        });

        console.log(`📞 Call ${callId} created by ${fullName} for ${targetUserId}`);

        // Set timeout to auto-reject if not answered
        setTimeout(() => {
          const currentCall = activeCalls.get(callId);
          if (currentCall && currentCall.status === 'initiating') {
            console.log(`⏰ Call ${callId} auto-rejected (timeout)`);
            
            // Update call status
            currentCall.status = 'missed';
            currentCall.endTime = new Date();
            activeCalls.set(callId, currentCall);
            
            // Notify caller
            socket.emit('call-missed', {
              callId,
              reason: 'No answer',
              timestamp: new Date().toISOString()
            });
            
            // Update user status
            userCallStatus.set(userId, {
              ...userCallStatus.get(userId),
              inCall: false,
              currentCallId: null
            });
            
            // Clean up after delay
            setTimeout(() => {
              if (activeCalls.get(callId)?.status === 'missed') {
                activeCalls.delete(callId);
              }
            }, 60000); // Clean up after 1 minute
          }
        }, 30000); // 30 second timeout

      } catch (error) {
        console.error('❌ Error creating call:', error);
        socket.emit('call-error', {
          type: 'CREATE_CALL_FAILED',
          message: 'Failed to create call',
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });

    /**
     * Accept incoming call
     */
    socket.on('accept-call', (data) => {
      try {
        const { callId } = data;
        const call = activeCalls.get(callId);

        if (!call) {
          return socket.emit('call-error', {
            type: 'CALL_NOT_FOUND',
            message: 'Call not found or expired',
            callId,
            timestamp: new Date().toISOString()
          });
        }

        // Verify this user is the target of the call
        if (call.targetUserId !== userId) {
          return socket.emit('call-error', {
            type: 'UNAUTHORIZED',
            message: 'Not authorized to accept this call',
            callId,
            timestamp: new Date().toISOString()
          });
        }

        // Update call status
        call.status = 'active';
        call.startTime = new Date();
        call.participants.push({
          userId,
          socketId: socket.id,
          joinedAt: new Date(),
          role: 'callee',
          userInfo: socket.user
        });

        activeCalls.set(callId, call);

        // Update user status
        userCallStatus.set(userId, {
          ...userCallStatus.get(userId),
          inCall: true,
          currentCallId: callId
        });

        // Notify both participants
        const callerSocketId = call.participants.find(p => p.role === 'caller')?.socketId;
        if (callerSocketId) {
          callNamespace.to(callerSocketId).emit('call-accepted', {
            callId,
            acceptorId: userId,
            acceptorName: fullName,
            timestamp: new Date().toISOString()
          });
        }

        // Emit to acceptor
        socket.emit('call-started', {
          callId,
          participants: call.participants.map(p => ({
            userId: p.userId,
            role: p.role,
            socketId: p.socketId,
            userName: p.userInfo?.fullName
          })),
          callType: call.callType,
          timestamp: new Date().toISOString()
        });

        console.log(`✅ Call ${callId} accepted by ${fullName}`);

      } catch (error) {
        console.error('❌ Error accepting call:', error);
        socket.emit('call-error', {
          type: 'ACCEPT_CALL_FAILED',
          message: 'Failed to accept call',
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });

    /**
     * Reject incoming call
     */
    socket.on('reject-call', (data) => {
      try {
        const { callId, reason = 'Call rejected' } = data;
        const call = activeCalls.get(callId);

        if (!call) {
          return socket.emit('call-error', {
            type: 'CALL_NOT_FOUND',
            message: 'Call not found',
            callId,
            timestamp: new Date().toISOString()
          });
        }

        // Update call status
        call.status = 'rejected';
        call.endTime = new Date();
        call.rejectReason = reason;

        // Notify caller
        const callerSocketId = call.participants.find(p => p.role === 'caller')?.socketId;
        if (callerSocketId) {
          callNamespace.to(callerSocketId).emit('call-rejected', {
            callId,
            rejectorId: userId,
            rejectorName: fullName,
            reason,
            timestamp: new Date().toISOString()
          });
        }

        // Update user status for caller
        const callerStatus = userCallStatus.get(call.creatorId);
        if (callerStatus) {
          userCallStatus.set(call.creatorId, {
            ...callerStatus,
            inCall: false,
            currentCallId: null
          });
        }

        console.log(`❌ Call ${callId} rejected by ${fullName}: ${reason}`);

        // Clean up after delay
        setTimeout(() => {
          activeCalls.delete(callId);
        }, 30000);

      } catch (error) {
        console.error('❌ Error rejecting call:', error);
        socket.emit('call-error', {
          type: 'REJECT_CALL_FAILED',
          message: 'Failed to reject call',
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });

    /**
     * WebRTC Signaling: Send offer (for direct calls)
     */
    socket.on('webrtc-offer', (data) => {
      try {
        const { callId, offer, targetUserId } = data;
        const call = activeCalls.get(callId);

        if (!call) {
          return socket.emit('call-error', {
            type: 'CALL_NOT_FOUND',
            message: 'Call not found during WebRTC signaling',
            callId,
            timestamp: new Date().toISOString()
          });
        }

        // Forward offer to target user
        callNamespace.to(`user:${targetUserId}`).emit('webrtc-offer', {
          callId,
          offer,
          fromUserId: userId,
          fromSocketId: socket.id,
          fromUserName: fullName,
          timestamp: new Date().toISOString()
        });

        console.log(`📡 WebRTC offer sent from ${fullName} to ${targetUserId} for call ${callId}`);

      } catch (error) {
        console.error('❌ Error sending WebRTC offer:', error);
        socket.emit('call-error', {
          type: 'WEBRTC_OFFER_FAILED',
          message: 'Failed to send WebRTC offer',
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });

    /**
     * WebRTC Signaling: Send answer (for direct calls)
     */
    socket.on('webrtc-answer', (data) => {
      try {
        const { callId, answer, targetUserId } = data;
        const call = activeCalls.get(callId);

        if (!call) {
          return socket.emit('call-error', {
            type: 'CALL_NOT_FOUND',
            message: 'Call not found during WebRTC signaling',
            callId,
            timestamp: new Date().toISOString()
          });
        }

        // Forward answer to target user
        callNamespace.to(`user:${targetUserId}`).emit('webrtc-answer', {
          callId,
          answer,
          fromUserId: userId,
          fromSocketId: socket.id,
          fromUserName: fullName,
          timestamp: new Date().toISOString()
        });

        console.log(`📡 WebRTC answer sent from ${fullName} to ${targetUserId} for call ${callId}`);

      } catch (error) {
        console.error('❌ Error sending WebRTC answer:', error);
        socket.emit('call-error', {
          type: 'WEBRTC_ANSWER_FAILED',
          message: 'Failed to send WebRTC answer',
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });

    /**
     * WebRTC Signaling: ICE candidate exchange (for direct calls)
     */
    socket.on('webrtc-ice-candidate', (data) => {
      try {
        const { callId, candidate, targetUserId } = data;
        const call = activeCalls.get(callId);

        if (!call) {
          return socket.emit('call-error', {
            type: 'CALL_NOT_FOUND',
            message: 'Call not found during ICE candidate exchange',
            callId,
            timestamp: new Date().toISOString()
          });
        }

        // Forward ICE candidate to target user
        callNamespace.to(`user:${targetUserId}`).emit('webrtc-ice-candidate', {
          callId,
          candidate,
          fromUserId: userId,
          fromSocketId: socket.id,
          fromUserName: fullName,
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        console.error('❌ Error sending ICE candidate:', error);
        socket.emit('call-error', {
          type: 'ICE_CANDIDATE_FAILED',
          message: 'Failed to send ICE candidate',
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });

    /**
     * End an ongoing call
     */
    socket.on('end-call', (data) => {
      try {
        const { callId, reason = 'Call ended' } = data;
        const call = activeCalls.get(callId);

        if (!call) {
          return socket.emit('call-error', {
            type: 'CALL_NOT_FOUND',
            message: 'Call not found',
            callId,
            timestamp: new Date().toISOString()
          });
        }

        // Check if user is part of this call
        const isParticipant = call.participants.some(p => p.userId === userId);
        if (!isParticipant) {
          return socket.emit('call-error', {
            type: 'UNAUTHORIZED',
            message: 'Not a participant of this call',
            callId,
            timestamp: new Date().toISOString()
          });
        }

        // Update call status
        call.status = 'ended';
        call.endTime = new Date();
        call.endReason = reason;
        call.endedBy = userId;

        // Notify all participants
        call.participants.forEach(participant => {
          if (participant.socketId !== socket.id) {
            callNamespace.to(participant.socketId).emit('call-ended', {
              callId,
              endedBy: userId,
              endedByName: fullName,
              reason,
              timestamp: new Date().toISOString(),
              duration: call.startTime ? 
                (new Date() - new Date(call.startTime)) / 1000 : 0
            });
          }
        });

        // Emit to self
        socket.emit('call-ended', {
          callId,
          endedBy: userId,
          reason,
          timestamp: new Date().toISOString(),
          duration: call.startTime ? 
            (new Date() - new Date(call.startTime)) / 1000 : 0
        });

        // Update user status for all participants
        call.participants.forEach(participant => {
          const participantStatus = userCallStatus.get(participant.userId);
          if (participantStatus) {
            userCallStatus.set(participant.userId, {
              ...participantStatus,
              inCall: false,
              currentCallId: null
            });
          }
        });

        console.log(`📞 Call ${callId} ended by ${fullName}: ${reason}`);

        // Store call history
        saveCallHistory(call);

        // Clean up after delay
        setTimeout(() => {
          activeCalls.delete(callId);
          
          // Also clean up peer connections for this call
          for (const [socketId, pc] of peerConnections) {
            if (pc.callId === callId) {
              peerConnections.delete(socketId);
            }
          }
        }, 60000);

      } catch (error) {
        console.error('❌ Error ending call:', error);
        socket.emit('call-error', {
          type: 'END_CALL_FAILED',
          message: 'Failed to end call',
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });

    /**
     * Mute/Unmute audio
     */
    socket.on('toggle-audio', (data) => {
      const { callId, isMuted } = data;
      const call = activeCalls.get(callId);

      if (call) {
        // Notify other participants
        call.participants.forEach(participant => {
          if (participant.userId !== userId && participant.socketId) {
            callNamespace.to(participant.socketId).emit('user-audio-changed', {
              callId,
              userId,
              userName: fullName,
              isMuted,
              timestamp: new Date().toISOString()
            });
          }
        });
      }
    });

    /**
     * Toggle video
     */
    socket.on('toggle-video', (data) => {
      const { callId, isVideoOn } = data;
      const call = activeCalls.get(callId);

      if (call) {
        // Notify other participants
        call.participants.forEach(participant => {
          if (participant.userId !== userId && participant.socketId) {
            callNamespace.to(participant.socketId).emit('user-video-changed', {
              callId,
              userId,
              userName: fullName,
              isVideoOn,
              timestamp: new Date().toISOString()
            });
          }
        });
      }
    });

    /**
     * Send call message (text chat during call)
     */
    socket.on('send-call-message', (data) => {
      const { callId, message } = data;
      const call = activeCalls.get(callId);

      if (call) {
        const messageData = {
          callId,
          fromUserId: userId,
          fromUserName: fullName,
          message,
          timestamp: new Date().toISOString(),
          type: 'text'
        };

        // Send to all call participants
        call.participants.forEach(participant => {
          if (participant.socketId) {
            callNamespace.to(participant.socketId).emit('call-message', messageData);
          }
        });
      }
    });

    /**
     * Check if user is available for calls
     */
    socket.on('check-user-availability', (data) => {
      const { targetUserId } = data;
      const targetStatus = userCallStatus.get(targetUserId);

      socket.emit('user-availability', {
        userId: targetUserId,
        isOnline: !!targetStatus,
        inCall: targetStatus?.inCall || false,
        currentCallId: targetStatus?.currentCallId || null,
        canReceiveCall: targetStatus && !targetStatus.inCall,
        timestamp: new Date().toISOString()
      });
    });

    /**
     * Get active calls for user
     */
    socket.on('get-active-calls', () => {
      const userCalls = [];
      
      for (const [callId, call] of activeCalls) {
        if (call.participants.some(p => p.userId === userId)) {
          userCalls.push({
            callId,
            callType: call.callType,
            status: call.status,
            participants: call.participants.map(p => ({
              userId: p.userId,
              role: p.role,
              userName: p.userInfo?.fullName
            })),
            startTime: call.startTime,
            duration: call.startTime ? 
              (new Date() - new Date(call.startTime)) / 1000 : 0
          });
        }
      }

      socket.emit('active-calls-list', {
        calls: userCalls,
        count: userCalls.length,
        timestamp: new Date().toISOString()
      });
    });

    /**
     * Get active rooms for user
     */
    socket.on('get-active-rooms', () => {
      const userRooms = [];
      
      for (const [roomId, room] of activeRooms) {
        if (room.participants.some(p => p.userId === userId)) {
          userRooms.push({
            roomId,
            creatorId: room.creatorId,
            creatorName: room.creatorName,
            participants: room.participants.map(p => ({
              userId: p.userId,
              userName: p.userInfo?.fullName,
              joinedAt: p.joinedAt
            })),
            participantsCount: room.participants.length,
            metadata: room.metadata,
            isLocked: room.isLocked,
            createdAt: room.metadata.createdAt
          });
        }
      }

      socket.emit('active-rooms-list', {
        rooms: userRooms,
        count: userRooms.length,
        timestamp: new Date().toISOString()
      });
    });

    /**
     * Debug: Get call statistics
     */
    socket.on('get-call-stats', () => {
      const stats = {
        totalActiveCalls: activeCalls.size,
        totalActiveRooms: activeRooms.size,
        totalConnectedUsers: callNamespace.sockets.size,
        activeUsersInCalls: Array.from(userCallStatus.entries()).filter(([_, status]) => status.inCall).length,
        activeUsersInRooms: Array.from(userCallStatus.entries()).filter(([_, status]) => status.currentRoom).length,
        userStatus: userCallStatus.get(userId),
        timestamp: new Date().toISOString()
      };

      socket.emit('call-stats', stats);
    });

    // ==================== DISCONNECT HANDLER ====================

    socket.on('disconnect', (reason) => {
      console.log(`📞 Call socket disconnected: ${fullName} (${socket.id})`, {
        reason,
        userId
      });

      // Handle room cleanup
      if (socket.currentRoom) {
        const roomId = socket.currentRoom;
        const room = activeRooms.get(roomId);
        
        if (room) {
          // Remove user from room participants
          room.participants = room.participants.filter(p => p.userId !== userId);
          
          // Notify other participants
          socket.to(roomId).emit('user-left', {
            roomId,
            userId,
            userName: fullName,
            reason: 'disconnected',
            timestamp: new Date().toISOString()
          });
          
          if (room.participants.length === 0) {
            // Delete empty room
            activeRooms.delete(roomId);
            console.log(`🗑️ Room ${roomId} deleted (empty after disconnect)`);
          } else {
            activeRooms.set(roomId, room);
          }
        }
      }

      // Handle active calls cleanup
      for (const [callId, call] of activeCalls) {
        if (call.participants.some(p => p.userId === userId)) {
          // Notify other participants
          call.participants.forEach(participant => {
            if (participant.userId !== userId && participant.socketId) {
              callNamespace.to(participant.socketId).emit('participant-left', {
                callId,
                userId,
                userName: fullName,
                reason: 'disconnected',
                timestamp: new Date().toISOString()
              });
            }
          });

          // If call becomes empty, end it
          const remainingParticipants = call.participants.filter(p => p.userId !== userId);
          if (remainingParticipants.length === 0) {
            activeCalls.delete(callId);
          } else {
            // Update call participants
            call.participants = remainingParticipants;
            activeCalls.set(callId, call);
          }
        }
      }

      // Update user status
      userCallStatus.delete(userId);

      // Clean up peer connections
      peerConnections.delete(socket.id);
    });

    // ==================== INITIALIZATION COMPLETE ====================

    socket.emit('call-socket-connected', {
      socketId: socket.id,
      userId,
      userInfo: socket.user,
      serverTime: new Date().toISOString(),
      message: 'Successfully connected to call server'
    });

    console.log(`🚀 ${fullName} call socket initialization complete`);
  });

  return callNamespace;
}

/**
 * Save call history to database (example function)
 */
async function saveCallHistory(call) {
  try {
    // Here you would save to your database
    // Example: await CallHistory.create(call);
    console.log(`💾 Call history saved for call ${call.id}`);
  } catch (error) {
    console.error('❌ Failed to save call history:', error);
  }
}

/**
 * Helper function to get call namespace
 */
function getCallNamespace() {
  return callNamespace;
}

/**
 * Helper function to check if user is in a call
 */
function isUserInCall(userId) {
  const status = userCallStatus.get(userId);
  return status?.inCall || false;
}

/**
 * Helper function to check if user is in a room
 */
function isUserInRoom(userId) {
  const status = userCallStatus.get(userId);
  return !!status?.currentRoom;
}

/**
 * Helper function to get user's current call
 */
function getUserCurrentCall(userId) {
  const status = userCallStatus.get(userId);
  if (!status?.currentCallId) return null;
  
  return activeCalls.get(status.currentCallId);
}

/**
 * Helper function to get user's current room
 */
function getUserCurrentRoom(userId) {
  const status = userCallStatus.get(userId);
  if (!status?.currentRoom) return null;
  
  return activeRooms.get(status.currentRoom);
}

/**
 * Debug function to get all active calls
 */
function getActiveCalls() {
  return Array.from(activeCalls.entries()).map(([id, call]) => ({
    id,
    ...call
  }));
}

/**
 * Debug function to get all active rooms
 */
function getActiveRooms() {
  return Array.from(activeRooms.entries()).map(([id, room]) => ({
    id,
    ...room
  }));
}

/**
 * Get room by ID
 */
function getRoomById(roomId) {
  return activeRooms.get(roomId);
}

/**
 * Get call by ID
 */
function getCallById(callId) {
  return activeCalls.get(callId);
}

/**
 * Broadcast message to all users in a room
 */
function broadcastToRoom(roomId, event, data) {
  if (callNamespace) {
    callNamespace.to(roomId).emit(event, data);
    return true;
  }
  return false;
}

/**
 * Get all connected users
 */
function getConnectedUsers() {
  const users = [];
  if (callNamespace) {
    for (const [socketId, socket] of callNamespace.sockets) {
      if (socket.user) {
        users.push({
          socketId,
          userId: socket.user.id,
          userName: socket.user.fullName,
          email: socket.user.email,
          connectedAt: socket.handshake.time,
          currentRoom: socket.currentRoom,
          currentCallId: userCallStatus.get(socket.user.id)?.currentCallId
        });
      }
    }
  }
  return users;
}

module.exports = {
  initCallSocket,
  getCallNamespace,
  isUserInCall,
  isUserInRoom,
  getUserCurrentCall,
  getUserCurrentRoom,
  getActiveCalls,
  getActiveRooms,
  getRoomById,
  getCallById,
  broadcastToRoom,
  getConnectedUsers
};