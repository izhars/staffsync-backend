const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const Message = require('../models/Message');
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const { uploadBase64ToCloudinary } = require('../middleware/upload');

// Connection tracking for debugging
const connectionLogs = new Map(); // socketId → connection info
const userConnectionHistory = new Map(); // userId → [connectionHistory]

// Maps for active users and typing states
const activeUsers = new Map(); // userId → Set(socketIds)
const socketToUser = new Map(); // socketId → userId
const typingUsers = new Map(); // socketId → { target, type, timeout }
const onlineUsers = new Map(); // userId → userInfo
let ioInstance = null;

const initChat = (io) => {
    ioInstance = io;

    // Connection monitoring middleware
    io.use((socket, next) => {
        const connectionId = Date.now();
        connectionLogs.set(socket.id, {
            id: connectionId,
            handshake: {
                headers: socket.handshake.headers,
                auth: { ...socket.handshake.auth, token: socket.handshake.auth?.token ? '***REDACTED***' : null },
                time: socket.handshake.time,
                address: socket.handshake.address,
                xdomain: socket.handshake.xdomain,
                secure: socket.handshake.secure,
                url: socket.handshake.url
            },
            connectedAt: new Date(),
            user: null,
            events: []
        });

        console.log(`🔌 New chat socket connection attempt: ${socket.id}`, {
            connectionId,
            origin: socket.handshake.headers.origin,
            userAgent: socket.handshake.headers['user-agent']
        });

        next();
    });

    // Authentication middleware
    io.use(async (socket, next) => {
        const token = socket.handshake.auth?.token ||
            socket.handshake.headers?.authorization?.replace('Bearer ', '');

        const logEntry = connectionLogs.get(socket.id);
        logEntry.events.push({
            type: 'AUTH_START',
            timestamp: new Date(),
            tokenPresent: !!token
        });

        if (!token) {
            logEntry.events.push({
                type: 'AUTH_FAILED',
                timestamp: new Date(),
                reason: 'No token provided'
            });
            return next(new Error('Authentication error: No token provided'));
        }

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const user = await User.findById(decoded.id)
                .select('firstName lastName role employeeId email profilePicture department status isOnline lastSeen lastActive');

            if (!user) {
                logEntry.events.push({
                    type: 'AUTH_FAILED',
                    timestamp: new Date(),
                    reason: 'User not found',
                    userId: decoded.id
                });
                return next(new Error('Authentication error: User not found'));
            }

            socket.user = {
                id: user._id.toString(),
                firstName: user.firstName,
                lastName: user.lastName,
                fullName: `${user.firstName} ${user.lastName}`.trim(),
                role: user.role,
                employeeId: user.employeeId,
                email: user.email,
                avatar: user.profilePicture?.url || '/default-avatar.png',
                department: user.department,
                status: user.status || 'active',
                isOnline: user.isOnline || false,
                lastSeen: user.lastSeen,
                lastActive: user.lastActive
            };

            logEntry.user = { ...socket.user, id: socket.user.id };
            logEntry.events.push({
                type: 'AUTH_SUCCESS',
                timestamp: new Date(),
                userId: socket.user.id,
                userEmail: socket.user.email
            });

            next();
        } catch (err) {
            logEntry.events.push({
                type: 'AUTH_ERROR',
                timestamp: new Date(),
                error: err.message,
                stack: err.stack
            });
            console.error('❌ Socket auth error:', err.message);
            next(new Error('Authentication error: ' + err.message));
        }
    });

    io.on('connection', (socket) => {
        const { id, firstName, lastName, role, fullName, avatar, email } = socket.user;
        const userId = id.toString();

        const logEntry = connectionLogs.get(socket.id);
        logEntry.events.push({
            type: 'CONNECTION_ESTABLISHED',
            timestamp: new Date(),
            userId,
            fullName
        });

        console.log(`✅ User connected: ${fullName} (${role})`, {
            socketId: socket.id,
            userId,
            email,
            connectionsCount: io.engine.clientsCount
        });

        // Store connection history
        if (!userConnectionHistory.has(userId)) {
            userConnectionHistory.set(userId, []);
        }

        userConnectionHistory.get(userId).push({
            socketId: socket.id,
            connectedAt: new Date(),
            userAgent: socket.handshake.headers['user-agent'],
            ip: socket.handshake.address
        });

        // Track active users
        if (!activeUsers.has(userId)) {
            activeUsers.set(userId, new Set());
        }
        activeUsers.get(userId).add(socket.id);
        socketToUser.set(socket.id, userId);

        // Update user's online status in database
        User.findByIdAndUpdate(userId, {
            isOnline: true,
            lastSeen: null,
            lastActive: new Date()
        }, { new: true })
            .then(updatedUser => {
                console.log(`📊 User ${fullName} online status updated:`, {
                    isOnline: updatedUser.isOnline,
                    lastActive: updatedUser.lastActive
                });
            })
            .catch(err => {
                console.error('❌ Failed to update user online status:', err.message);
            });

        // Store online user info
        onlineUsers.set(userId, {
            ...socket.user,
            socketId: socket.id,
            connectedAt: new Date(),
            isOnline: true
        });

        // Emit online status to relevant users
        emitOnlineStatus(userId, true, io);

        // Load user's active conversations
        loadUserConversations(userId, socket);

        // ==================== DEBUG EVENTS ====================

        socket.on('debug-ping', (data) => {
            console.log(`🔔 Debug ping from ${fullName}:`, data);
            socket.emit('debug-pong', {
                timestamp: Date.now(),
                socketId: socket.id,
                userId,
                serverTime: new Date().toISOString(),
                data: data
            });
        });

        socket.on('get-connection-info', () => {
            socket.emit('connection-info', {
                socketId: socket.id,
                userId,
                userInfo: socket.user,
                connectedAt: logEntry.connectedAt,
                events: logEntry.events,
                activeUsersCount: activeUsers.size,
                onlineUsersCount: onlineUsers.size
            });
        });

        // Add this socket event handler in your Socket.IO server:
        socket.on('load-messages', async (data) => {
            const { conversationId, page = 1, limit = 50 } = data;
            const userId = socket.user.id;

            console.log(`📨 Loading messages for conversation: ${conversationId} for user ${userId}`);

            try {
                // Verify user is part of conversation
                const conversation = await Conversation.findOne({
                    _id: conversationId,
                    'participants.user': userId
                });

                if (!conversation) {
                    return socket.emit('error', {
                        type: 'UNAUTHORIZED',
                        message: 'Not authorized to access this conversation'
                    });
                }

                const messages = await Message.find({
                    conversationId: conversationId
                })
                    .sort({ timestamp: 1 }) // Ascending for chronological order
                    .skip((page - 1) * limit)
                    .limit(limit)
                    .lean();

                console.log(`✅ Found ${messages.length} messages for conversation ${conversationId}`);

                // Format messages
                const formattedMessages = messages.map(msg => formatMessage(msg));

                // FIXED: Send as object, not array
                socket.emit('messages-loaded', {
                    success: true,
                    conversationId: conversationId,
                    messages: formattedMessages,
                    page: page,
                    limit: limit,
                    total: messages.length,
                    hasMore: messages.length === limit,
                    timestamp: new Date().toISOString()
                });

            } catch (err) {
                console.error('💥 Error loading messages:', err);
                socket.emit('error', {
                    type: 'LOAD_MESSAGES_FAILED',
                    message: 'Failed to load messages',
                    error: err.message
                });
            }
        });

        /* ==================== CHAT HISTORY (per-user, paginated) ==================== */

        socket.on('load-history', async ({ targetUserId, page = 1, limit = 50 } = {}) => {
            const requesterId = socket.user.id;

            try {
                if (!targetUserId) {
                    return socket.emit('error', {
                        type: 'LOAD_HISTORY_FAILED',
                        message: 'targetUserId is required',
                    });
                }

                // 1. Find (or create) the direct conversation between the two users
                let conversation = await Conversation.findOne({
                    type: 'direct',
                    participants: {
                        $all: [
                            { $elemMatch: { user: requesterId } },
                            { $elemMatch: { user: targetUserId } },
                        ],
                    },
                }).select('_id');

                if (!conversation) {
                    // No conversation yet → return empty page, but tell client to stop paginating
                    return socket.emit('chat-history', {
                        targetUserId,
                        messages: [],
                        page,
                        limit,
                        hasMore: false,
                        timestamp: new Date().toISOString(),
                    });
                }

                // 2. Fetch page of messages, newest-first so page 1 = most recent
                const skip = Math.max(0, (page - 1) * limit);

                // IMPORTANT: sort DESC here, then reverse before sending.
                // This way page 1 = latest 50, page 2 = previous 50, etc.
                const raw = await Message.find({ conversationId: conversation._id })
                    .sort({ timestamp: -1 })
                    .skip(skip)
                    .limit(limit + 1) // +1 to detect hasMore
                    .lean();

                const hasMore = raw.length > limit;
                const pageSlice = hasMore ? raw.slice(0, limit) : raw;

                // Reverse to chronological order (oldest → newest) for the UI
                const chronological = pageSlice.reverse();

                // 3. Format using your existing helper
                const messages = chronological.map((m) => ({
                    ...formatMessage(m),
                    // client expects `_id` and `fromRole` — add them
                    _id: m._id.toString(),
                    fromRole: m.senderRole,
                    to: m.to?.toString(),
                    from: m.sender?.toString(),
                    readAt: m.readAt || null,
                }));

                socket.emit('chat-history', {
                    targetUserId,
                    messages,
                    page,
                    limit,
                    hasMore,
                    timestamp: new Date().toISOString(),
                });
            } catch (err) {
                console.error('💥 load-history error:', err);
                socket.emit('error', {
                    type: 'LOAD_HISTORY_FAILED',
                    message: 'Failed to load chat history',
                    error: err.message,
                });
            }
        });

        // ==================== CONNECTION TESTING ====================

        socket.on('test-connection', ({ targetUserId }) => {
            const targetSockets = activeUsers.get(targetUserId);
            const targetUser = onlineUsers.get(targetUserId);

            const response = {
                timestamp: new Date().toISOString(),
                fromUser: {
                    id: userId,
                    name: fullName,
                    socketId: socket.id
                },
                toUser: {
                    id: targetUserId,
                    isOnline: !!targetSockets,
                    socketIds: targetSockets ? Array.from(targetSockets) : [],
                    userInfo: targetUser
                },
                connectionStatus: targetSockets ? 'TARGET_ONLINE' : 'TARGET_OFFLINE',
                message: targetSockets ?
                    `User is online with ${targetSockets.size} connection(s)` :
                    'User is offline'
            };

            console.log(`🔗 Connection test from ${fullName} to ${targetUserId}:`, response);

            socket.emit('test-connection-result', response);

            // If target is online, also notify them
            if (targetSockets) {
                targetSockets.forEach(targetSocketId => {
                    io.to(targetSocketId).emit('connection-test-received', {
                        from: userId,
                        fromName: fullName,
                        timestamp: new Date().toISOString()
                    });
                });
            }
        });

        // ==================== DIRECT MESSAGES (1:1) ====================

        socket.on('send-message', async (data) => {
            const startTime = Date.now();
            const { toUserId, text, attachment, clientId } = data;
            const sender = socket.user;

            logEntry.events.push({
                type: 'MESSAGE_SEND_ATTEMPT',
                timestamp: new Date(),
                toUserId,
                hasText: !!text,
                hasAttachment: !!attachment,
                clientId
            });

            try {
                if (!toUserId) {
                    throw new Error('Recipient ID is required');
                }

                // Validate user roles can communicate
                const canCommunicate = await validateCommunication(sender.id, toUserId);
                if (!canCommunicate) {
                    throw new Error('Not authorized to communicate with this user');
                }

                let attachmentData = null;

                // ============================================================
                // ATTACHMENT HANDLING
                // ============================================================
                // Case 1: Pre-uploaded via HTTP (PREFERRED — frontend already
                //         sent file to Cloudinary and got back url + publicId)
                // ============================================================
                if (attachment && attachment.url && attachment.publicId) {
                    attachmentData = {
                        type: attachment.type || 'file',
                        url: attachment.url,
                        publicId: attachment.publicId,
                        width: attachment.width || null,
                        height: attachment.height || null,
                        size: attachment.size || 0,
                        filename: attachment.filename || attachment.fileName || `file_${Date.now()}`,
                        mimeType: attachment.mimeType || 'application/octet-stream'
                    };
                    console.log('📎 Using pre-uploaded attachment:', attachmentData.url);
                }
                // ============================================================
                // Case 2: Base64 image needs uploading (legacy fallback)
                // ============================================================
                else if (attachment && attachment.type === 'image' && attachment.base64) {
                    try {
                        console.log(`📤 ${fullName} uploading image for ${toUserId}`);
                        const uploadResult = await uploadBase64ToCloudinary(attachment.base64, {
                            folder: 'chat_images',
                            resource_type: 'image'
                        });

                        attachmentData = {
                            type: 'image',
                            url: uploadResult.url,
                            publicId: uploadResult.publicId,
                            width: uploadResult.width,
                            height: uploadResult.height,
                            size: attachment.size || 0,
                            filename: attachment.filename || `image_${Date.now()}`,
                            mimeType: attachment.mimeType || 'image/jpeg'
                        };
                    } catch (uploadErr) {
                        console.error('❌ Image upload failed:', uploadErr);
                        throw new Error('Failed to upload image');
                    }
                }

                // Create or get conversation
                let conversation = await Conversation.findOne({
                    type: 'direct',
                    participants: {
                        $all: [
                            { $elemMatch: { user: sender.id } },
                            { $elemMatch: { user: toUserId } }
                        ]
                    }
                });

                // If no conversation exists, create one
                if (!conversation) {
                    conversation = new Conversation({
                        type: 'direct',
                        participants: [
                            { user: sender.id, role: 'member', joinedAt: new Date() },
                            { user: toUserId, role: 'member', joinedAt: new Date() }
                        ],
                        name: 'Direct Chat',
                        createdBy: sender.id,
                        settings: {
                            isPublic: false,
                            approvalRequired: false
                        }
                    });
                    await conversation.save();

                    console.log(`💬 New conversation created between ${sender.id} and ${toUserId}`);

                    // Notify both users about new conversation
                    io.to(`user:${sender.id}`).to(`user:${toUserId}`).emit('new-conversation', {
                        conversation: formatConversation(conversation, userId)
                    });
                }

                // ============================================================
                // Determine message type based on attachment
                // ============================================================
                let resolvedMessageType = 'text';
                if (attachmentData) {
                    if (attachmentData.type === 'image') resolvedMessageType = 'image';
                    else if (attachmentData.type === 'video') resolvedMessageType = 'video';
                    else if (attachmentData.type === 'audio') resolvedMessageType = 'audio';
                    else resolvedMessageType = 'file';
                }

                // Create message
                const message = new Message({
                    sender: sender.id,
                    to: toUserId,
                    conversationId: conversation._id,
                    text: text || '',
                    messageType: resolvedMessageType,
                    senderName: fullName,
                    senderRole: role,
                    senderAvatar: avatar,
                    attachment: attachmentData,
                    metadata: {
                        clientId,
                        timestamp: new Date().toISOString(),
                        socketId: socket.id
                    }
                });

                await message.save();

                // Update conversation last message
                conversation.lastMessage = {
                    messageId: message._id,
                    text: text || (attachmentData
                        ? (attachmentData.type === 'image' ? '📷 Photo' : '📎 Attachment')
                        : ''),
                    senderId: sender.id,
                    senderName: fullName,
                    timestamp: message.timestamp,
                    messageType: message.messageType
                };
                conversation.messageCount += 1;
                conversation.updatedAt = new Date();
                await conversation.save();

                // Format message for sending
                const formattedMessage = formatMessage(message, sender);

                // Check if recipient is online
                const recipientSockets = activeUsers.get(toUserId);
                const isRecipientOnline = recipientSockets?.size > 0;

                logEntry.events.push({
                    type: 'MESSAGE_PROCESSED',
                    timestamp: new Date(),
                    messageId: message._id.toString(),
                    recipientOnline: isRecipientOnline,
                    recipientSocketCount: recipientSockets?.size || 0,
                    processingTime: Date.now() - startTime
                });

                // Send to recipient if online
                if (recipientSockets?.size) {
                    // Mark as delivered
                    message.deliveredAt = new Date();
                    await message.save();

                    console.log(`📨 Message from ${fullName} to ${toUserId} (online)`, {
                        messageId: message._id,
                        recipientSockets: Array.from(recipientSockets)
                    });

                    // Emit to recipient
                    recipientSockets.forEach(sid => {
                        io.to(sid).emit('receive-message', {
                            ...formattedMessage,
                            conversationId: conversation._id.toString(),
                            delivered: true,
                            deliveredAt: message.deliveredAt.toISOString()
                        });
                    });

                    // Send delivery confirmation to sender
                    socket.emit('message-delivered', {
                        messageId: message._id.toString(),
                        deliveredAt: message.deliveredAt.toISOString(),
                        conversationId: conversation._id.toString(),
                        recipientOnline: true
                    });
                } else {
                    console.log(`📨 Message from ${fullName} to ${toUserId} (offline - queued)`);
                    socket.emit('message-queued', {
                        messageId: message._id.toString(),
                        conversationId: conversation._id.toString(),
                        recipientOnline: false,
                        timestamp: new Date().toISOString()
                    });
                }

                // Send to sender (for their own UI)
                socket.emit('message-sent', {
                    ...formattedMessage,
                    conversationId: conversation._id.toString(),
                    sentAt: new Date().toISOString()
                });

                // Update conversation list for both users
                io.to(`user:${sender.id}`).to(`user:${toUserId}`).emit('conversation-updated', {
                    conversationId: conversation._id.toString(),
                    lastMessage: formattedMessage,
                    updatedAt: conversation.updatedAt,
                    recipientOnline: isRecipientOnline
                });

            } catch (err) {
                console.error('💥 send-message error:', err);
                logEntry.events.push({
                    type: 'MESSAGE_SEND_ERROR',
                    timestamp: new Date(),
                    error: err.message,
                    stack: err.stack
                });
                socket.emit('error', {
                    type: 'MESSAGE_SEND_FAILED',
                    message: 'Failed to send message',
                    error: err.message,
                    clientId: data.clientId
                });
            }
        });

        // ==================== TYPING INDICATORS ====================

        socket.on('typing-start', ({ toUserId, conversationId }) => {
            console.log(`✍️  ${fullName} typing to ${toUserId}`);

            const receiverSockets = activeUsers.get(toUserId);
            if (receiverSockets?.size) {
                receiverSockets.forEach(sid => {
                    io.to(sid).emit('user-typing', {
                        fromUserId: userId,
                        fromName: fullName,
                        conversationId: conversationId || null
                    });
                });
            }

            // Clear existing timeout
            const existing = typingUsers.get(socket.id);
            if (existing?.timeout) clearTimeout(existing.timeout);

            // Set timeout to auto-stop typing after 3 seconds
            const timeout = setTimeout(() => {
                socket.emit('typing-stop', { toUserId });
            }, 3000);

            typingUsers.set(socket.id, {
                target: toUserId,
                type: 'direct',
                conversationId,
                timeout: timeout
            });
        });

        socket.on('typing-stop', ({ toUserId }) => {
            console.log(`✍️  ${fullName} stopped typing to ${toUserId}`);

            const receiverSockets = activeUsers.get(toUserId);
            if (receiverSockets?.size) {
                receiverSockets.forEach(sid => {
                    io.to(sid).emit('user-stopped-typing', {
                        fromUserId: userId,
                        conversationId: null
                    });
                });
            }

            const existing = typingUsers.get(socket.id);
            if (existing?.timeout) clearTimeout(existing.timeout);
            typingUsers.delete(socket.id);
        });

        // ==================== CONNECTION MONITORING ====================

        socket.on('get-online-status', ({ userIds }) => {
            console.log(`👤 User ${fullName} requesting online status for: ${userIds}`);

            const statuses = {};
            userIds.forEach(userId => {
                statuses[userId] = activeUsers.has(userId);
            });

            socket.emit('online-status-response', {
                statuses,
                timestamp: new Date().toISOString()
            });
        });

        socket.on('update-presence', ({ status }) => {
            console.log(`👤 ${fullName} presence updated: ${status}`);

            // Emit presence change to relevant users
            Conversation.find({
                'participants.user': userId,
                type: 'direct'
            })
                .then(conversations => {
                    conversations.forEach(conv => {
                        const otherParticipant = conv.participants.find(p => p.user.toString() !== userId);
                        if (otherParticipant) {
                            const recipientSockets = activeUsers.get(otherParticipant.user.toString());
                            if (recipientSockets) {
                                recipientSockets.forEach(sid => {
                                    io.to(sid).emit('user-presence-changed', {
                                        userId,
                                        isOnline: status === 'online',
                                        timestamp: new Date().toISOString()
                                    });
                                });
                            }
                        }
                    });
                });
        });

        // Add this event for loading conversations
        socket.on('load-conversations', () => {
            console.log(`📋 Loading conversations for ${fullName}`);
            loadUserConversations(userId, socket);
        });

        socket.on('mark-conversation-read', ({ conversationId }) => {
            console.log(`📖 Marking conversation ${conversationId} as read by ${fullName}`);

            // Update conversation unread count
            Conversation.findByIdAndUpdate(conversationId, {
                $set: { 'lastMessage.readBy': userId }
            }).catch(console.error);
        });

        socket.on('mark-as-read', async ({ messageId }) => {
            try {
                console.log(`👁 Marking message ${messageId} as read by ${fullName}`);

                const message = await Message.findById(messageId);
                if (!message) return;

                // Add user to readBy if not already there
                if (!message.readBy.includes(userId)) {
                    message.readBy.push(userId);
                    message.readAt = new Date();
                    await message.save();

                    // Notify sender that their message was read
                    const senderSockets = activeUsers.get(message.sender.toString());
                    if (senderSockets?.size) {
                        senderSockets.forEach(sid => {
                            io.to(sid).emit('message-read', {
                                messageId: message._id.toString(),
                                readBy: userId,
                                readAt: message.readAt.toISOString(),
                                conversationId: message.conversationId.toString()
                            });
                        });
                    }
                }
            } catch (err) {
                console.error('❌ Error marking message as read:', err);
            }
        });

        socket.on('get-online-users', () => {
            const users = Array.from(onlineUsers.entries()).map(([id, user]) => ({
                id,
                name: user.fullName,
                role: user.role,
                avatar: user.avatar,
                isOnline: true,
                socketCount: activeUsers.get(id)?.size || 0,
                lastActive: user.lastActive
            }));

            socket.emit('online-users-list', {
                users,
                total: users.length,
                timestamp: new Date().toISOString()
            });
        });

        socket.on('check-user-status', ({ userId: targetUserId }) => {
            const isOnline = activeUsers.has(targetUserId);
            const user = onlineUsers.get(targetUserId);

            socket.emit('user-status-response', {
                userId: targetUserId,
                isOnline,
                userInfo: user,
                socketCount: isOnline ? activeUsers.get(targetUserId).size : 0,
                timestamp: new Date().toISOString()
            });
        });

        // ==================== GROUP MESSAGES ====================

        // Add to socket events in your Socket.IO server
        socket.on('send-group-message', async (data) => {
            const { groupId, text, attachment, clientId } = data;
            const sender = socket.user;

            try {
                // Get group
                const group = await Conversation.findById(groupId);
                if (!group || group.type !== 'group') {
                    throw new Error('Group not found');
                }

                // Check if user is member of group
                const isMember = group.participants.some(p =>
                    p.user.toString() === sender.id
                );

                if (!isMember) {
                    throw new Error('Not a member of this group');
                }

                let attachmentData = null;

                // Handle image upload
                if (attachment && attachment.type === 'image' && attachment.base64) {
                    const uploadResult = await uploadBase64ToCloudinary(attachment.base64, {
                        folder: 'group_chat_images',
                        resource_type: 'image'
                    });

                    attachmentData = {
                        type: 'image',
                        url: uploadResult.url,
                        publicId: uploadResult.publicId,
                        width: uploadResult.width,
                        height: uploadResult.height,
                        size: attachment.size || 0,
                        filename: attachment.filename || `image_${Date.now()}`,
                        mimeType: attachment.mimeType || 'image/jpeg'
                    };
                }

                // Create message
                const message = new Message({
                    sender: sender.id,
                    conversationId: groupId,
                    text: text || '',
                    messageType: attachmentData ? 'image' : 'text',
                    senderName: sender.fullName,
                    senderRole: sender.role,
                    senderAvatar: sender.avatar,
                    attachment: attachmentData,
                    metadata: {
                        clientId,
                        isGroup: true,
                        timestamp: new Date().toISOString(),
                        socketId: socket.id
                    }
                });

                await message.save();

                // Update group last message
                group.lastMessage = {
                    messageId: message._id,
                    text: text || (attachmentData ? 'Sent an image' : ''),
                    senderId: sender.id,
                    senderName: sender.fullName,
                    timestamp: message.timestamp,
                    messageType: message.messageType
                };
                group.messageCount += 1;
                group.updatedAt = new Date();
                await group.save();

                // Format message
                const formattedMessage = {
                    ...message.toObject(),
                    _id: message._id.toString(),
                    timestamp: message.timestamp.toISOString(),
                    metadata: {
                        ...message.metadata,
                        isGroup: true,
                        groupId: groupId
                    }
                };

                // Send to all group members who are online
                const onlineMembers = [];

                for (const participant of group.participants) {
                    const userId = participant.user.toString();
                    if (userId === sender.id) continue;

                    const memberSockets = activeUsers.get(userId);
                    if (memberSockets?.size) {
                        memberSockets.forEach(sid => {
                            io.to(sid).emit('receive-group-message', {
                                ...formattedMessage,
                                conversationId: groupId,
                                groupId: groupId,
                                groupName: group.name
                            });
                            onlineMembers.push(userId);
                        });
                    }
                }

                // Send confirmation to sender
                socket.emit('group-message-sent', {
                    ...formattedMessage,
                    conversationId: groupId,
                    groupId: groupId,
                    onlineMembers,
                    sentAt: new Date().toISOString()
                });

                // Update conversations for all members
                for (const participant of group.participants) {
                    const userId = participant.user.toString();
                    const userSockets = activeUsers.get(userId);
                    if (userSockets?.size) {
                        userSockets.forEach(sid => {
                            io.to(sid).emit('conversation-updated', {
                                conversationId: groupId,
                                lastMessage: formattedMessage,
                                updatedAt: group.updatedAt,
                                groupId: groupId
                            });
                        });
                    }
                }

            } catch (err) {
                console.error('💥 send-group-message error:', err);
                socket.emit('error', {
                    type: 'GROUP_MESSAGE_SEND_FAILED',
                    message: 'Failed to send group message',
                    error: err.message,
                    clientId: data.clientId
                });
            }
        });

        // Group typing indicators
        socket.on('group-typing-start', ({ groupId }) => {
            const sender = socket.user;

            // Notify all group members except sender
            const group = Conversation.findById(groupId);
            if (group) {
                group.participants.forEach(participant => {
                    const userId = participant.user.toString();
                    if (userId !== sender.id) {
                        const memberSockets = activeUsers.get(userId);
                        if (memberSockets?.size) {
                            memberSockets.forEach(sid => {
                                io.to(sid).emit('group-user-typing', {
                                    fromUserId: sender.id,
                                    fromName: sender.fullName,
                                    groupId: groupId
                                });
                            });
                        }
                    }
                });
            }
        });

        socket.on('group-typing-stop', ({ groupId }) => {
            const sender = socket.user;

            // Notify all group members except sender
            const group = Conversation.findById(groupId);
            if (group) {
                group.participants.forEach(participant => {
                    const userId = participant.user.toString();
                    if (userId !== sender.id) {
                        const memberSockets = activeUsers.get(userId);
                        if (memberSockets?.size) {
                            memberSockets.forEach(sid => {
                                io.to(sid).emit('group-user-stopped-typing', {
                                    fromUserId: sender.id,
                                    groupId: groupId
                                });
                            });
                        }
                    }
                });
            }
        });

        // ==================== PING/PONG for Connection Health ====================

        let pingInterval;

        socket.on('ping', (data) => {
            socket.emit('pong', {
                timestamp: Date.now(),
                serverTime: new Date().toISOString(),
                data: data
            });
        });

        // Start periodic health check
        pingInterval = setInterval(() => {
            socket.emit('health-check', {
                timestamp: Date.now(),
                connectionId: socket.id,
                serverTime: new Date().toISOString()
            });
        }, 30000); // Every 30 seconds

        // ==================== DISCONNECT ====================

        socket.on('disconnect', async (reason) => {
            // Get userId from socketToUser map before anything else
            const userId = socketToUser.get(socket.id);
            const userName = userId ? (onlineUsers.get(userId)?.fullName || 'Unknown user') : 'Unknown user';

            console.log(`❌ ${userName} disconnected: ${socket.id}`, {
                reason,
                userId,
                connectedFor: Date.now() - new Date(logEntry.connectedAt).getTime()
            });

            logEntry.events.push({
                type: 'DISCONNECTED',
                timestamp: new Date(),
                reason,
                duration: Date.now() - new Date(logEntry.connectedAt).getTime(),
                userId: userId || null
            });

            // Clean up intervals
            if (pingInterval) clearInterval(pingInterval);

            // Remove from socketToUser map
            socketToUser.delete(socket.id);

            // Clear typing timeout
            const typingData = typingUsers.get(socket.id);
            if (typingData?.timeout) clearTimeout(typingData.timeout);
            typingUsers.delete(socket.id);

            if (userId && activeUsers.has(userId)) {
                const userSockets = activeUsers.get(userId);
                userSockets.delete(socket.id);

                if (userSockets.size === 0) {
                    // User is completely offline
                    activeUsers.delete(userId);
                    onlineUsers.delete(userId);

                    await User.findByIdAndUpdate(userId, {
                        lastSeen: new Date(),
                        isOnline: false,
                        lastActive: new Date()
                    }).catch(console.error);

                    console.log(`👋 ${userName} is now offline`);

                    // Notify others
                    emitOnlineStatus(userId, false, io);
                } else {
                    console.log(`🔄 ${userName} still has ${userSockets.size} other connection(s)`);
                }
            }

            // Clean up logs after 5 minutes
            setTimeout(() => {
                connectionLogs.delete(socket.id);
            }, 300000);
        });

        // ==================== INITIALIZATION COMPLETE ====================

        socket.emit('connection-established', {
            socketId: socket.id,
            userId,
            userInfo: socket.user,
            serverTime: new Date().toISOString(),
            onlineUsersCount: onlineUsers.size,
            message: 'Successfully connected to chat server'
        });

        console.log(`🚀 ${fullName} chat initialization complete`);



    });

    return io;
};

// ==================== HELPER FUNCTIONS ====================

async function validateCommunication(senderId, receiverId) {
    try {
        const [sender, receiver] = await Promise.all([
            User.findById(senderId).select('role department status'),
            User.findById(receiverId).select('role department status')
        ]);

        if (!sender || !receiver) {
            console.log(`❌ Validation failed: User not found`, { senderId, receiverId });
            return false;
        }

        // Check if both users are active
        if (sender.status !== 'active' || receiver.status !== 'active') {
            console.log(`❌ Validation failed: User not active`, {
                senderStatus: sender.status,
                receiverStatus: receiver.status
            });
            return false;
        }

        const roles = [sender.role, receiver.role];

        // All roles can communicate with each other in 1:1 chat
        const allowedRoles = ['hr', 'manager', 'employee'];

        const canCommunicate = allowedRoles.includes(sender.role) && allowedRoles.includes(receiver.role);

        console.log(`🔍 Communication validation: ${senderId} → ${receiverId}`, {
            canCommunicate,
            senderRole: sender.role,
            receiverRole: receiver.role
        });

        return canCommunicate;
    } catch (err) {
        console.error('❌ Validation error:', err);
        return false;
    }
}

function formatMessage(message, sender = null) {
  const msgObj = message.toObject ? message.toObject() : message;

  return {
    _id: msgObj._id.toString(),
    id:  msgObj._id.toString(),
    text: msgObj.text || '',
    from: msgObj.sender?.toString() || msgObj.from?.toString(),
    to: msgObj.to?.toString(),
    fromRole: msgObj.senderRole || (sender ? sender.role : ''),
    senderId: msgObj.sender?.toString() || msgObj.from?.toString(),
    senderName: msgObj.senderName || (sender ? sender.fullName : ''),
    senderRole: msgObj.senderRole || (sender ? sender.role : ''),
    senderAvatar: msgObj.senderAvatar || (sender ? sender.avatar : ''),
    timestamp: msgObj.timestamp ? new Date(msgObj.timestamp).toISOString() : new Date().toISOString(),
    deliveredAt: msgObj.deliveredAt ? new Date(msgObj.deliveredAt).toISOString() : null,
    readAt: msgObj.readAt ? new Date(msgObj.readAt).toISOString() : null,
    readBy: msgObj.readBy || [],
    messageType: msgObj.messageType || 'text',
    conversationId: msgObj.conversationId?.toString(),
    attachment: msgObj.attachment || null,
    metadata: msgObj.metadata || {},
    clientId: msgObj.metadata?.clientId || null,  // <-- ADD THIS LINE
  };
}

function formatConversation(conversation, userId) {
    const convObj = conversation.toObject ? conversation.toObject() : conversation;

    const otherParticipant = convObj.participants?.find(p => p.user.toString() !== userId);
    const otherUser = otherParticipant?.user;

    return {
        id: convObj._id.toString(),
        name: convObj.name,
        type: convObj.type,
        avatar: convObj.avatar,
        lastMessage: convObj.lastMessage || null,
        messageCount: convObj.messageCount || 0,
        unreadCount: convObj.unreadCount || 0,
        updatedAt: convObj.updatedAt ? new Date(convObj.updatedAt).toISOString() : new Date().toISOString(),
        createdAt: convObj.createdAt ? new Date(convObj.createdAt).toISOString() : new Date().toISOString(),
        participants: convObj.participants || [],
        otherParticipant: otherParticipant,
        otherUserId: otherUser,
        isOtherUserOnline: otherUser ? activeUsers.has(otherUser.toString()) : false
    };
}

// In your Socket.IO server code:
async function loadUserConversations(userId, socket) {
    try {
        console.log(`📂 Loading conversations for user: ${userId}`);

        const conversations = await Conversation.find({
            'participants.user': userId,
            type: 'direct'
        })
            .sort({ updatedAt: -1 })
            .limit(50)
            .populate('participants.user', 'firstName lastName email role profilePicture isOnline lastSeen')
            .lean();

        console.log(`📂 Found ${conversations.length} conversations for ${userId}`);

        const formattedConversations = conversations.map(conv =>
            formatConversation(conv, userId)
        );

        // FIXED: Send as object with conversations array
        socket.emit('conversations-loaded', {
            success: true,
            conversations: formattedConversations,
            count: formattedConversations.length,
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        console.error('💥 Error loading conversations:', err);
        socket.emit('error', {
            type: 'LOAD_CONVERSATIONS_FAILED',
            message: 'Failed to load conversations',
            error: err.message
        });
    }
}

function emitOnlineStatus(userId, isOnline, io) {
    const user = onlineUsers.get(userId);
    if (!user && isOnline) return;

    const statusEvent = isOnline ? 'user-online' : 'user-offline';
    const statusData = {
        userId,
        isOnline,
        timestamp: new Date().toISOString(),
        userInfo: user ? {
            name: user.fullName,
            role: user.role,
            avatar: user.avatar,
            department: user.department
        } : null
    };

    console.log(`📢 Emitting ${statusEvent} for user ${userId}`);

    // Notify all users who have conversations with this user
    Conversation.find({
        'participants.user': userId,
        type: 'direct'
    })
        .then(conversations => {
            conversations.forEach(conv => {
                const otherParticipant = conv.participants.find(p => p.user.toString() !== userId);
                if (otherParticipant) {
                    const recipientSockets = activeUsers.get(otherParticipant.user.toString());
                    if (recipientSockets) {
                        recipientSockets.forEach(sid => {
                            io.to(sid).emit(statusEvent, statusData);
                        });
                    }
                }
            });
        })
        .catch(err => {
            console.error('❌ Error emitting online status:', err);
        });
}

// Debug function to get connection statistics
function getConnectionStats() {
    return {
        totalConnections: ioInstance ? ioInstance.sockets.sockets.size : 0,
        activeUsers: activeUsers.size,
        onlineUsers: onlineUsers.size,
        connectionLogs: connectionLogs.size,
        userConnectionHistory: userConnectionHistory.size,
        timestamp: new Date().toISOString()
    };
}

// Function to debug specific user connection
function debugUserConnection(userId) {
    const sockets = activeUsers.get(userId);
    const userInfo = onlineUsers.get(userId);
    const history = userConnectionHistory.get(userId) || [];

    return {
        userId,
        isOnline: !!sockets,
        socketIds: sockets ? Array.from(sockets) : [],
        userInfo,
        connectionHistory: history.slice(-10), // Last 10 connections
        currentConnections: sockets?.size || 0
    };
}

module.exports = {
    initChat,
    getIo: () => ioInstance,
    getOnlineUsers: () => Array.from(onlineUsers.values()),
    getConnectionStats,
    debugUserConnection,
    isUserOnline: (userId) => activeUsers.has(userId),
    getUserSockets: (userId) => activeUsers.get(userId)
};