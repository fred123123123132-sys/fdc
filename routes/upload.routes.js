// routes/upload.routes.js - File Upload Routes with Cloudinary
const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');
const { authenticate } = require('../middleware/auth');
const pool = require('../config/database');
const logger = require('../utils/logger');

// Upload file
router.post('/', authenticate, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const { receiverId } = req.body;
    if (!receiverId) {
      return res.status(400).json({ success: false, error: 'Receiver ID required' });
    }

    // Create message with attachment
    const messageResult = await pool.query(
      'INSERT INTO messages (sender_id, receiver_id, content, has_attachment) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.user.id, receiverId, `📎 ${req.file.originalname}`, true]
    );

    const message = messageResult.rows[0];

    // Save attachment metadata with Cloudinary URL
    await pool.query(
      'INSERT INTO attachments (message_id, filename, original_filename, mimetype, size, file_path) VALUES ($1, $2, $3, $4, $5, $6)',
      [
        message.id,
        req.file.filename,
        req.file.originalname,
        req.file.mimetype,
        req.file.size,
        req.file.path // Cloudinary URL
      ]
    );

    // Log upload
    await pool.query(
      'INSERT INTO logs (user_id, action_type, target_user_id, target_message_id, metadata) VALUES ($1, $2, $3, $4, $5)',
      [
        req.user.id,
        'FILE_UPLOADED',
        receiverId,
        message.id,
        JSON.stringify({
          filename: req.file.originalname,
          size: req.file.size,
          mimetype: req.file.mimetype,
          cloudinaryUrl: req.file.path
        })
      ]
    );

    logger.info(`File uploaded to Cloudinary: ${req.file.originalname} by ${req.user.username}`);

    res.json({
      success: true,
      message: {
        ...message,
        attachment: {
          url: req.file.path,
          filename: req.file.originalname,
          mimetype: req.file.mimetype,
          size: req.file.size
        }
      }
    });

  } catch (error) {
    logger.error('File upload error:', error);
    res.status(500).json({ success: false, error: 'Failed to upload file' });
  }
});

// Get file info (for download link)
router.get('/download/:messageId', authenticate, async (req, res) => {
  try {
    const { messageId } = req.params;

    const result = await pool.query(
      `SELECT a.*, m.sender_id, m.receiver_id 
       FROM attachments a 
       JOIN messages m ON a.message_id = m.id 
       WHERE a.message_id = $1`,
      [messageId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }

    const attachment = result.rows[0];

    // Verify user has access
    const hasAccess = 
      attachment.sender_id === req.user.id ||
      attachment.receiver_id === req.user.id ||
      req.user.role === 'admin' ||
      req.user.role === 'superadmin';

    if (!hasAccess) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    // Return Cloudinary URL
    res.json({
      success: true,
      url: attachment.file_path,
      filename: attachment.original_filename,
      mimetype: attachment.mimetype
    });

  } catch (error) {
    logger.error('File download error:', error);
    res.status(500).json({ success: false, error: 'Failed to get file' });
  }
});

module.exports = router;
