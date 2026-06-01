const Room = require('../models/Room');

exports.createRoom = async(req,res) => {
  try{
    const {name} = req.body;
    if(!name?.trim()){
      return res.status(400).json({error: 'Room name is required'});
    }

    const room = new Room({name,createdBy: req.user.id});
    await room.save();
    res.status(201).json(room);
  }
  catch(err){
    res.status(500).json({error: 'Failed to create room'});
  }
};

exports.getAllRooms = async(req,res) => {
  try{
    const rooms = await Room.find().sort({createdAt: -1}).populate('createdBy', 'username');
    res.json(rooms);
  }
  catch(err){
    res.status(500).json({error: 'Failed to fetch rooms'});
  }
};

exports.getRoomById = async (req,res) => {
  try{
    const room = await Room.findById(req.params.id);
    if (!room) {
      return res.status(404).json({error: 'Room not found'});
    }
    res.json({room,messages:room.messages});
  }
  catch(err){
    res.status(404).json({error: 'Room not found'});
  }
};
