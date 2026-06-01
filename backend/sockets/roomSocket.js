const Room = require('../models/Room');

const USER_COLORS = [
  '#4F9CF9', '#f9f516', '#22C55E', '#A855F7',
  '#EF4444', '#14B8A6', '#F59E0B', '#EC4899'
];

const roomUsers = {}; 
const codeDebounceMap=new Map();

const getUniqueRoomUsers = (roomId) => {
  const uniqueUsers = new Map();
  for(const user of roomUsers[roomId] || []) {
    uniqueUsers.set(user.userId, user);
  }
  return Array.from(uniqueUsers.values());
};

const getRoomColor = (roomId, userId) => {
  const users = getUniqueRoomUsers(roomId);
  const existingUser = users.find((user) => user.userId === userId);
  if(existingUser) return existingUser.color;

  const usedColors = new Set(users.map((user) => user.color));
  return USER_COLORS.find((color) => !usedColors.has(color)) || USER_COLORS[users.length % USER_COLORS.length];
};

module.exports = (io) => {
  io.on('connection',(socket) => {
    
    socket.on('join_room', async ({roomId, userId, username}) => {
      try{
        const room = await Room.findById(roomId);
        if(!room){
          return socket.emit('room_error', {message:'Room not found'});
        }
        if(socket.data.roomId && socket.data.roomId !== roomId){
          socket.leave(socket.data.roomId);
          if(roomUsers[socket.data.roomId]){
            roomUsers[socket.data.roomId] = roomUsers[socket.data.roomId].filter(u => u.socketId !== socket.id);
            socket.to(socket.data.roomId).emit('user_left', {users: getUniqueRoomUsers(socket.data.roomId)});
          }
        }

        socket.join(roomId);
        socket.data.roomId = roomId;
        socket.data.userId = userId;

        socket.emit('load_initial_state',{ 
          code: room.code, 
          language: room.language,
          messages: room.messages
        });

        if(!roomUsers[roomId]) roomUsers[roomId] = [];
        const color = getRoomColor(roomId, userId);
        const userData = {socketId:socket.id, userId, username, color};
        socket.data.color = color;
        socket.data.username = username;

        roomUsers[roomId] = roomUsers[roomId].filter((u) => u.userId !== userId && u.socketId !== socket.id);
        roomUsers[roomId].push(userData);
        const users = getUniqueRoomUsers(roomId);

        socket.to(roomId).emit('user_joined',{userId, username, color, users});
        socket.emit('user_joined', {userId, username, color, users});
      }
      catch(err){
        console.error("Join Room Error:", err);
        socket.emit('room_error', {message: 'Unable to join room'});
      }
    });

    socket.on('send_message', async({roomId, username, text}) => {
      const message = {username, text, timestamp: new Date()};
      io.to(roomId).emit('receive_message', message);

      try{
        await Room.findByIdAndUpdate(roomId,{ 
          $push: {messages: message} 
        });
      }
      catch(err){
        console.error("Failed to save message to DB:", err);
      }
    });

    socket.on('run_code',async ({roomId, code, language_id, input}) => {
      try{
        const base64Code = Buffer.from(code).toString('base64');
        const base64Input = input ? Buffer.from(input).toString('base64') : null;

        const response = await fetch('http://localhost:2358/submissions?wait=true&base64_encoded=true', {
          method:'POST',
          headers:{'Content-Type': 'application/json'},
          body: JSON.stringify({
            source_code:base64Code,
            language_id:language_id,
            stdin:base64Input,
            enable_per_process_and_thread_time_limit:true,
            enable_per_process_and_thread_memory_limit:true
          })
        });

        if(!response.ok){
          const errorText = await response.text();
          console.error("Judge0 API Error:", response.status, errorText);
          return io.to(roomId).emit('execution_result', {
            output: "Compiler service returned an error."
          });
        }
        
        const result = await response.json();

        const stdout = result.stdout ? Buffer.from(result.stdout, 'base64').toString('ascii') : null;
        const stderr = result.stderr ? Buffer.from(result.stderr, 'base64').toString('ascii') : null;
        const compile_output = result.compile_output ? Buffer.from(result.compile_output, 'base64').toString('ascii') : null;

        io.to(roomId).emit('execution_result',{
          output: stdout || stderr || compile_output || result.message || result.status?.description || "No output"
        });
      }
      catch(err){
        console.error("Judge0 Runtime Error:", err);
        io.to(roomId).emit('execution_result', {output: "Error communicating with compiler."});
      }
    });

    socket.on('code_change',async({roomId,code}) => {
      socket.to(roomId).emit('code_update', {code});
      if (codeDebounceMap.has(roomId)) clearTimeout(codeDebounceMap.get(roomId));
      codeDebounceMap.set(roomId, setTimeout(async () => {
        try{
          await Room.findByIdAndUpdate(roomId,{code});
          console.log(`Auto-saved room ${roomId} to DB`);
        }
        catch(err){
          console.error("DB Save Error:",err);
        }
      }, 1000));
    });

    socket.on('language_change', async({roomId, language}) => {
      try{
        const room = await Room.findByIdAndUpdate(roomId, {language}, {runValidators:true,new:true});
        if(!room){
          return socket.emit('room_error', {message: 'Room not found'});
        }

        io.to(roomId).emit('language_updated',{language: room.language});
      }
      catch(err){
        console.error("Language Update Error:", err);
        socket.emit('room_error', {message:'Unable to update language'});
      }
    });

    socket.on('cursor_move',({roomId,cursor,userId,username}) => {
      socket.to(roomId).emit('cursor_update', {
        userId,
        username: socket.data.username || username,
        color: socket.data.color || USER_COLORS[0],
        cursor
      });
    });

    socket.on('disconnect', () => {
      const joinedRoomId = socket.data.roomId;
      const roomIds = joinedRoomId ? [joinedRoomId] : Object.keys(roomUsers);

      for(const roomId of roomIds){
        if(!roomUsers[roomId]) continue;
        roomUsers[roomId] = roomUsers[roomId].filter(u => u.socketId !== socket.id);
        socket.to(roomId).emit('user_left', {users: getUniqueRoomUsers(roomId)});
        if(roomUsers[roomId].length === 0) delete roomUsers[roomId];
      }
    });
  });
};
