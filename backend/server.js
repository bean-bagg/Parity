require('dotenv').config();
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const {Server} = require('socket.io');

const authRoutes = require('./routes/auth');
const roomRoutes = require('./routes/rooms');
const roomSocket = require('./sockets/roomSocket');

const app = express();
const server = http.createServer(app);

app.use(cors({origin: process.env.CLIENT_URL}));
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/rooms', roomRoutes);

app.get('/health',(req,res) => res.status(200).json({status: 'ok'}));

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:',err));

const io = new Server(server,{
  cors:{ 
    origin: process.env.CLIENT_URL,
    methods: ["GET", "POST"] 
  }
});

roomSocket(io);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
