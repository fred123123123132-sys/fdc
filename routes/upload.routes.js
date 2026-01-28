const express = require("express");
const router = express.Router();
const upload = require("../middleware/upload");
const { authenticate } = require("../middleware/auth");
const pool = require("../config/database");
const logger = require("../utils/logger");

router.post("/", authenticate, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, error: "No file uploaded" });
    }

    const { receiverId } = req.body;
    if (!receiverId) {
      return res
        .status(400)
        .json({ success: false, error: "Receiver ID required" });
    }

    const messageResult = await pool.query(
      "INSERT INTO messages (sender_id, receiver_id, content, has_attachment) VALUES ($1, $2, $3, $4) RETURNING *",
      [req.user.id, receiverId, `📎 ${req.file.originalname}`, true],
    );

    const message = messageResult.rows[0];

    await pool.query(
      "INSERT INTO attachments (message_id, filename, original_filename, mimetype, size, file_path) VALUES ($1, $2, $3, $4, $5, $6)",
      [
        message.id,
        req.file.filename,
        req.file.originalname,
        req.file.mimetype,
        req.file.size,
        req.file.path,
      ],
    );

    res.json({ success: true, message });
  } catch (error) {
    logger.error("Upload error:", error);
    res.status(500).json({ success: false, error: "Upload failed" });
  }
});

module.exports = router;
