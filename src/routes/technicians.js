const express = require('express');
const sheets = require('../services/googleSheets');
const audit = require('../services/auditLog');
const config = require('../config');
const { nowISO } = require('../utils/dateUtils');

const router = express.Router();

function rowToTechnician(row) {
  return {
    id: row[0] || '',
    name: row[1] || '',
    pin: row[2] || '',
    phone: row[3] || '',
    status: row[4] || 'active',
    createdAt: row[5] || '',
    updatedAt: row[6] || '',
  };
}

// GET /api/technicians
router.get('/', async (req, res) => {
  try {
    const rows = await sheets.getRows(config.sheets.technicians);
    if (rows.length <= 1) return res.json([]);

    let technicians = rows.slice(1).map(r => {
      const t = rowToTechnician(r);
      // ไม่ส่ง PIN ออกไป
      delete t.pin;
      return t;
    });

    if (req.query.status) {
      technicians = technicians.filter(t => t.status === req.query.status);
    }

    res.json(technicians);
  } catch (err) {
    console.error('GET /technicians error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด: ' + err.message });
  }
});

// GET /api/technicians/:id
router.get('/:id', async (req, res) => {
  try {
    const rows = await sheets.getRows(config.sheets.technicians);
    const row = rows.find((r, i) => i > 0 && r[0] === req.params.id);
    if (!row) return res.status(404).json({ error: 'ไม่พบข้อมูลช่าง' });

    const t = rowToTechnician(row);
    // ไม่ส่ง PIN ออกไป (ส่งแค่ masked)
    t.pinMasked = t.pin ? '●'.repeat(t.pin.length) : '';
    delete t.pin;
    res.json(t);
  } catch (err) {
    console.error('GET /technicians/:id error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด: ' + err.message });
  }
});

// POST /api/technicians
router.post('/', async (req, res) => {
  try {
    const { name, pin, phone } = req.body;

    if (!name || !pin) {
      return res.status(400).json({ error: 'กรุณากรอกชื่อและ PIN' });
    }

    if (pin.length < 4) {
      return res.status(400).json({ error: 'PIN ต้องมีอย่างน้อย 4 หลัก' });
    }

    // เช็ค PIN ซ้ำ
    const rows = await sheets.getRows(config.sheets.technicians);
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][2] === pin) {
        return res.status(400).json({ error: 'PIN นี้ถูกใช้แล้ว กรุณาใช้ PIN อื่น' });
      }
    }

    // เช็คว่า PIN ไม่ตรงกับ Admin PIN
    if (pin === config.appPin) {
      return res.status(400).json({ error: 'PIN นี้ถูกใช้แล้ว กรุณาใช้ PIN อื่น' });
    }

    const id = await sheets.generateId(config.sheets.technicians, 'T');
    const now = nowISO();

    await sheets.appendRow(config.sheets.technicians, [
      id, name, pin, phone || '', 'active', now, now,
    ]);

    await audit.log('create', 'technician', id, { name, phone }, req.user?.displayName || 'admin');

    res.json({ success: true, id });
  } catch (err) {
    console.error('POST /technicians error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด: ' + err.message });
  }
});

// PUT /api/technicians/:id
router.put('/:id', async (req, res) => {
  try {
    const rows = await sheets.getRows(config.sheets.technicians);
    let rowIndex = -1;
    let oldRow = null;

    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === req.params.id) {
        rowIndex = i + 1;
        oldRow = rows[i];
        break;
      }
    }

    if (rowIndex === -1) return res.status(404).json({ error: 'ไม่พบข้อมูลช่าง' });

    const { name, pin, phone, status } = req.body;

    // ถ้าเปลี่ยน PIN ต้องเช็คซ้ำ
    if (pin && pin !== oldRow[2]) {
      if (pin.length < 4) {
        return res.status(400).json({ error: 'PIN ต้องมีอย่างน้อย 4 หลัก' });
      }
      if (pin === config.appPin) {
        return res.status(400).json({ error: 'PIN นี้ถูกใช้แล้ว กรุณาใช้ PIN อื่น' });
      }
      for (let i = 1; i < rows.length; i++) {
        if (i + 1 !== rowIndex && rows[i][2] === pin) {
          return res.status(400).json({ error: 'PIN นี้ถูกใช้แล้ว กรุณาใช้ PIN อื่น' });
        }
      }
      oldRow[2] = pin;
    }

    if (name !== undefined) oldRow[1] = name;
    if (phone !== undefined) oldRow[3] = phone;
    if (status !== undefined) oldRow[4] = status;
    oldRow[6] = nowISO();

    await sheets.updateRow(config.sheets.technicians, rowIndex, oldRow);

    await audit.log('update', 'technician', req.params.id, req.body, req.user?.displayName || 'admin');

    res.json({ success: true });
  } catch (err) {
    console.error('PUT /technicians/:id error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด: ' + err.message });
  }
});

module.exports = router;
