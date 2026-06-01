const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
  name:{type:String, required:true, trim:true},
  createdBy: {type: mongoose.Schema.Types.ObjectId, ref:'User', required:true},
  messages: [{username: String, text: String, timestamp:{type: Date, default: Date.now}}],
  code:{type: String, default: '// Start coding here...'},
  language: {type: String, default: 'javascript', enum: ['javascript', 'python', 'cpp']},
  createdAt: {type: Date, default: Date.now}
});

module.exports=mongoose.model('Room', roomSchema);
