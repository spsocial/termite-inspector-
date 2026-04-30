const express = require('express');
const jwt = require('jsonwebtoken');
const config = require('../config');
const sheets = require('../services/googleSheets');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { pin } = req.body;

  if (!pin) {
    return res.status(400).json({ error: 'กรุณาใส่ PIN' });
  }

  // 1. เช็ค Admin PIN
  if (pin === config.appPin) {
    const token = jwt.sign(
      { role: 'admin', displayName: 'Admin', loginAt: new Date().toISOString() },
      config.jwtSecret,
      { expiresIn: '30d' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    return res.json({ success: true, token, role: 'admin', displayName: 'Admin' });
  }

  // 2. เช็ค PIN จากชีทช่าง
  try {
    const rows = await sheets.getRows(config.sheets.technicians);
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][2] === pin && rows[i][4] === 'active') {
        const techId = rows[i][0];
        const techName = rows[i][1];

        const token = jwt.sign(
          {
            role: 'technician',
            technicianId: techId,
            displayName: techName,
            loginAt: new Date().toISOString(),
          },
          config.jwtSecret,
          { expiresIn: '30d' }
        );

        res.cookie('token', token, {
          httpOnly: true,
          secure: config.nodeEnv === 'production',
          sameSite: 'lax',
          maxAge: 30 * 24 * 60 * 60 * 1000,
        });

        return res.json({ success: true, token, role: 'technician', displayName: techName, technicianId: techId });
      }
    }
  } catch (err) {
    console.error('Login technician check error:', err.message);
  }

  // 3. PIN ไม่ตรง
  return res.status(401).json({ error: 'PIN ไม่ถูกต้อง' });
});

router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

router.post('/change-pin', (req, res) => {
  const { currentPin, newPin } = req.body;

  if (currentPin !== config.appPin) {
    return res.status(401).json({ error: 'PIN ปัจจุบันไม่ถูกต้อง' });
  }

  if (!newPin || newPin.length < 4) {
    return res.status(400).json({ error: 'PIN ใหม่ต้องมีอย่างน้อย 4 หลัก' });
  }

  config.appPin = newPin;
  process.env.APP_PIN = newPin;

  res.json({ success: true, message: 'เปลี่ยน PIN เรียบร้อย' });
});

module.exports = router;
