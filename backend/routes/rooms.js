const express = require('express');
const router = express.Router();
const {createRoom,getAllRooms,getRoomById} = require('../controllers/roomController');
const authMiddleware=require('../middleware/authMiddleware');

router.use(authMiddleware);
router.post('/', createRoom);
router.get('/', getAllRooms);
router.get('/:id', getRoomById);

module.exports = router;
