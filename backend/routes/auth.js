const express = require('express');
const router = express.Router();
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

router.post('/signup', async(req,res) => {
  try{
    const {username, email, password} = req.body;
    const newUser=new User({username,email,password});
    await newUser.save();

    const token = jwt.sign({id:newUser._id, username:newUser.username}, process.env.JWT_SECRET, {expiresIn: '7d'});
    res.status(201).json({token, user: {id: newUser._id, username: newUser.username, email: newUser.email}});
  }
  catch(err){
    res.status(400).json({error: 'Signup failed. Email or username might be taken.'});
  }
});

router.post('/login', async(req,res) => {
  try{
    const {email, password} = req.body;
    const user = await User.findOne({email});
    if(!user) return res.status(404).json({error: 'User not found'});

    const isMatch = await bcrypt.compare(password, user.password);
    if(!isMatch) return res.status(401).json({error:'Invalid credentials'});

    const token=jwt.sign({id: user._id,username: user.username}, process.env.JWT_SECRET, {expiresIn: '7d'});
    res.json({token, user:{id:user._id,username: user.username,email: user.email}});
  }
  catch(err){
    res.status(500).json({error: 'Login failed'});
  }
});

module.exports = router;
