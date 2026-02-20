const express = require('express');
const sheets = require('../services/googleSheets');
const config = require('../config');

const router = express.Router();

// GET /api/history
router.get('/', async (req, res) => {
  try {
    const rows = await sheets.getRows(config.sheets.auditLog);
    if (rows.length <= 1) return res.json([]);

    let logs = rows.slice(1).map(row => ({
      timestamp: row[0] || '',
      action: row[1] || '',
      entity: row[2] || '',
      entityId: row[3] || '',
      changes: row[4] || '',
      user: row[5] || '',
    }));

    // กรองตาม entity
    if (req.query.entity) {
      logs = logs.filter(l => l.entity === req.query.entity);
    }

    // กรองตาม entityId
    if (req.query.entityId) {
      logs = logs.filter(l => l.entityId === req.query.entityId);
    }

    // เรียงจากใหม่ → เก่า
    logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // จำกัดจำนวน
    const limit = parseInt(req.query.limit) || 100;
    logs = logs.slice(0, limit);

    res.json(logs);
  } catch (err) {
    console.error('GET /history error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด: ' + err.message });
  }
});

module.exports = router;
