const express = require('express');
const jwt = require('jsonwebtoken');
const config = require('../config');

const router = express.Router();

router.post('/login', (req, res) => {
  const { pin } = req.body;

  if (!pin) {
    return res.status(400).json({ error: 'กรุณาใส่ PIN' });
  }

  // ตรวจสอบ PIN: admin หรือ ช่าง
  let role = null;
  if (pin === config.appPin) {
    role = 'admin';
  } else if (pin === config.techPin) {
    role = 'technician';
  }

  if (!role) {
    return res.status(401).json({ error: 'PIN ไม่ถูกต้อง' });
  }

  const token = jwt.sign(
    { role, loginAt: new Date().toISOString() },
    config.jwtSecret,
    { expiresIn: '30d' }
  );

  res.cookie('token', token, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });

  res.json({ success: true, token, role });
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

  // ในการ deploy จริงควรเก็บใน database แต่ตอนนี้แก้ตรง env
  // สำหรับ Railway ต้องแก้ผ่าน environment variable
  config.appPin = newPin;
  process.env.APP_PIN = newPin;

  res.json({ success: true, message: 'เปลี่ยน PIN เรียบร้อย' });
});

module.exports = router;
