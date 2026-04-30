const express = require('express');
const multer = require('multer');
const sheets = require('../services/googleSheets');
const audit = require('../services/auditLog');
const telegram = require('../services/telegram');
const config = require('../config');
const { toISO, nowISO, today, daysBetween, toThaiDisplay } = require('../utils/dateUtils');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Helper: ดึงชื่อผู้ใช้จาก req.user
function getUserName(req) {
  return req.user?.displayName || 'unknown';
}

function rowToInspection(row) {
  return {
    id: row[0] || '',
    customerId: row[1] || '',
    round: row[2] || '',
    dueDate: row[3] || '',
    actualDate: row[4] || '',
    status: row[5] || 'pending',
    result: row[6] || '',
    technician: row[7] || '',
    photos: row[8] || '',
    createdAt: row[9] || '',
    updatedAt: row[10] || '',
    claimedBy: row[11] || '',
    claimedByName: row[12] || '',
  };
}

// GET /api/inspections
router.get('/', async (req, res) => {
  try {
    const inspRows = await sheets.getRows(config.sheets.inspections);
    if (inspRows.length <= 1) return res.json([]);

    const custRows = await sheets.getRows(config.sheets.customers);
    const customerMap = {};
    custRows.slice(1).forEach(r => {
      customerMap[r[0]] = { name: r[1], phone: r[2], address: r[3] };
    });

    const now = today();

    let inspections = inspRows.slice(1).map(row => {
      const insp = rowToInspection(row);

      if (insp.status === 'pending' && insp.dueDate) {
        const due = new Date(insp.dueDate);
        if (due < now) {
          insp.status = 'overdue';
        }
      }

      const customer = customerMap[insp.customerId] || {};
      return {
        ...insp,
        customerName: customer.name || 'ไม่พบข้อมูล',
        customerPhone: customer.phone || '',
        customerAddress: customer.address || '',
        daysUntilDue: insp.dueDate ? daysBetween(now, new Date(insp.dueDate)) : null,
      };
    });

    // กรองตาม status
    if (req.query.status && req.query.status !== 'all') {
      inspections = inspections.filter(i => i.status === req.query.status);
    }

    // กรองตาม customerId
    if (req.query.customerId) {
      inspections = inspections.filter(i => i.customerId === req.query.customerId);
    }

    // กรองตามช่างที่รับงาน
    if (req.query.claimedBy) {
      inspections = inspections.filter(i => i.claimedBy === req.query.claimedBy);
    }

    // กรองตามช่วงวันที่
    if (req.query.from) {
      inspections = inspections.filter(i => i.dueDate >= req.query.from);
    }
    if (req.query.to) {
      inspections = inspections.filter(i => i.dueDate <= req.query.to);
    }

    // ค้นหา
    if (req.query.search) {
      const q = req.query.search.toLowerCase();
      inspections = inspections.filter(i =>
        i.customerName.toLowerCase().includes(q) ||
        i.customerId.toLowerCase().includes(q) ||
        i.id.toLowerCase().includes(q)
      );
    }

    // เรียงตามวันกำหนด
    inspections.sort((a, b) => {
      if (a.status === 'overdue' && b.status !== 'overdue') return -1;
      if (b.status === 'overdue' && a.status !== 'overdue') return 1;
      return new Date(a.dueDate) - new Date(b.dueDate);
    });

    res.json(inspections);
  } catch (err) {
    console.error('GET /inspections error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด: ' + err.message });
  }
});

// GET /api/inspections/:id
router.get('/:id', async (req, res) => {
  try {
    const inspRows = await sheets.getRows(config.sheets.inspections);
    const row = inspRows.find((r, i) => i > 0 && r[0] === req.params.id);
    if (!row) return res.status(404).json({ error: 'ไม่พบรายการตรวจเช็ค' });

    const insp = rowToInspection(row);

    const custRows = await sheets.getRows(config.sheets.customers);
    const custRow = custRows.find((r, i) => i > 0 && r[0] === insp.customerId);

    if (custRow) {
      insp.customer = {
        id: custRow[0],
        name: custRow[1],
        phone: custRow[2],
        address: custRow[3],
        buildingType: custRow[4],
        jobType: custRow[5],
      };
    }

    res.json(insp);
  } catch (err) {
    console.error('GET /inspections/:id error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด: ' + err.message });
  }
});

// PUT /api/inspections/:id/claim - ช่างกดรับงาน
router.put('/:id/claim', async (req, res) => {
  try {
    const inspRows = await sheets.getRows(config.sheets.inspections);
    let rowIndex = -1;
    let oldRow = null;

    for (let i = 1; i < inspRows.length; i++) {
      if (inspRows[i][0] === req.params.id) {
        rowIndex = i + 1;
        oldRow = inspRows[i];
        break;
      }
    }

    if (rowIndex === -1) return res.status(404).json({ error: 'ไม่พบรายการตรวจเช็ค' });

    const techId = req.user?.technicianId || '';
    const techName = req.user?.displayName || '';

    // เช็คว่ามีคนรับแล้วหรือยัง
    if (oldRow[11] && oldRow[11] !== techId) {
      return res.status(400).json({ error: `งานนี้ถูกรับโดย ${oldRow[12] || oldRow[11]} แล้ว` });
    }

    // ถ้ารับอยู่แล้ว = ยกเลิกรับ
    if (oldRow[11] === techId) {
      oldRow[11] = '';
      oldRow[12] = '';
      oldRow[10] = nowISO();

      await sheets.updateRow(config.sheets.inspections, rowIndex, oldRow);
      await audit.log('unclaim', 'inspection', req.params.id, { technicianId: techId }, techName);

      return res.json({ success: true, action: 'unclaimed' });
    }

    // รับงาน
    // ขยาย row ให้มี column ครบ
    while (oldRow.length < 13) oldRow.push('');
    oldRow[11] = techId;
    oldRow[12] = techName;
    oldRow[10] = nowISO();

    await sheets.updateRow(config.sheets.inspections, rowIndex, oldRow);
    await audit.log('claim', 'inspection', req.params.id, { technicianId: techId, technicianName: techName }, techName);

    res.json({ success: true, action: 'claimed' });
  } catch (err) {
    console.error('PUT /inspections/:id/claim error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด: ' + err.message });
  }
});

// PUT /api/inspections/:id/complete - ติ๊กเสร็จ
router.put('/:id/complete', async (req, res) => {
  try {
    const inspRows = await sheets.getRows(config.sheets.inspections);
    let rowIndex = -1;
    let oldRow = null;

    for (let i = 1; i < inspRows.length; i++) {
      if (inspRows[i][0] === req.params.id) {
        rowIndex = i + 1;
        oldRow = inspRows[i];
        break;
      }
    }

    if (rowIndex === -1) return res.status(404).json({ error: 'ไม่พบรายการตรวจเช็ค' });

    const { result } = req.body;
    // ชื่อช่าง: ใช้จาก session ถ้าเป็นช่าง, ถ้า admin ส่งมาในbody ก็ใช้
    let technician = req.body.technician;
    if (req.user?.role === 'technician') {
      technician = req.user.displayName;
    }

    const now = nowISO();
    const todayStr = toISO(today());

    while (oldRow.length < 13) oldRow.push('');
    oldRow[4] = todayStr;
    oldRow[5] = 'completed';
    oldRow[6] = result || oldRow[6] || '';
    oldRow[7] = technician || oldRow[7] || '';
    oldRow[10] = now;

    await sheets.updateRow(config.sheets.inspections, rowIndex, oldRow);

    await audit.log('complete', 'inspection', req.params.id, {
      actualDate: todayStr, result, technician,
    }, getUserName(req));

    // แจ้งเตือน Telegram
    const custRows = await sheets.getRows(config.sheets.customers);
    const custRow = custRows.find((r, i) => i > 0 && r[0] === oldRow[1]);
    const customerName = custRow ? custRow[1] : oldRow[1];

    telegram.sendMessageAsync(
      `✅ <b>ตรวจเช็คเสร็จสิ้น</b>\n` +
      `👤 ลูกค้า: ${customerName}\n` +
      `📋 รอบที่: ${oldRow[2]}\n` +
      `👷 ช่าง: ${technician || '-'}\n` +
      `📝 ผล: ${result || '-'}\n` +
      `📅 วันที่: ${toThaiDisplay(todayStr)}`
    );

    res.json({ success: true });
  } catch (err) {
    console.error('PUT /inspections/:id/complete error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด: ' + err.message });
  }
});

// PUT /api/inspections/:id - อัพเดทรายละเอียด
router.put('/:id', async (req, res) => {
  try {
    const inspRows = await sheets.getRows(config.sheets.inspections);
    let rowIndex = -1;
    let oldRow = null;

    for (let i = 1; i < inspRows.length; i++) {
      if (inspRows[i][0] === req.params.id) {
        rowIndex = i + 1;
        oldRow = inspRows[i];
        break;
      }
    }

    if (rowIndex === -1) return res.status(404).json({ error: 'ไม่พบรายการตรวจเช็ค' });

    const { actualDate, status, result, technician } = req.body;
    const now = nowISO();

    if (actualDate !== undefined) oldRow[4] = actualDate;
    if (status !== undefined) oldRow[5] = status;
    if (result !== undefined) oldRow[6] = result;
    if (technician !== undefined) oldRow[7] = technician;
    oldRow[10] = now;

    await sheets.updateRow(config.sheets.inspections, rowIndex, oldRow);

    await audit.log('update', 'inspection', req.params.id, req.body, getUserName(req));

    res.json({ success: true });
  } catch (err) {
    console.error('PUT /inspections/:id error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด: ' + err.message });
  }
});

// POST /api/inspections/:id/photos - อัพโหลดรูป
router.post('/:id/photos', upload.array('photos', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'กรุณาเลือกรูปภาพ' });
    }

    const inspRows = await sheets.getRows(config.sheets.inspections);
    let rowIndex = -1;
    let oldRow = null;

    for (let i = 1; i < inspRows.length; i++) {
      if (inspRows[i][0] === req.params.id) {
        rowIndex = i + 1;
        oldRow = inspRows[i];
        break;
      }
    }

    if (rowIndex === -1) return res.status(404).json({ error: 'ไม่พบรายการตรวจเช็ค' });

    const uploadedLinks = [];

    for (const file of req.files) {
      const result = await sheets.uploadFile(
        file.buffer,
        `${req.params.id}_${Date.now()}_${file.originalname}`,
        file.mimetype
      );
      uploadedLinks.push(result.directLink);
    }

    const existingPhotos = oldRow[8] ? oldRow[8].split(',') : [];
    const allPhotos = [...existingPhotos, ...uploadedLinks];
    oldRow[8] = allPhotos.join(',');
    oldRow[10] = nowISO();

    await sheets.updateRow(config.sheets.inspections, rowIndex, oldRow);

    res.json({ success: true, photos: uploadedLinks });
  } catch (err) {
    console.error('POST /inspections/:id/photos error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด: ' + err.message });
  }
});

// POST /api/inspections/batch-complete - ติ๊กเสร็จหลายรายการ
router.post('/batch-complete', async (req, res) => {
  try {
    const { ids, result } = req.body;
    let { technician } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'กรุณาเลือกรายการ' });
    }

    // ถ้าเป็นช่าง ใช้ชื่อจาก session
    if (req.user?.role === 'technician') {
      technician = req.user.displayName;
    }

    const inspRows = await sheets.getRows(config.sheets.inspections);
    const now = nowISO();
    const todayStr = toISO(today());
    let completedCount = 0;

    for (const id of ids) {
      for (let i = 1; i < inspRows.length; i++) {
        if (inspRows[i][0] === id) {
          while (inspRows[i].length < 13) inspRows[i].push('');
          inspRows[i][4] = todayStr;
          inspRows[i][5] = 'completed';
          if (result) inspRows[i][6] = result;
          if (technician) inspRows[i][7] = technician;
          inspRows[i][10] = now;

          await sheets.updateRow(config.sheets.inspections, i + 1, inspRows[i]);
          completedCount++;
          break;
        }
      }
    }

    await audit.log('batch-complete', 'inspection', ids.join(','), {
      count: completedCount, technician, result,
    }, getUserName(req));

    telegram.sendMessageAsync(
      `✅ <b>ตรวจเช็คเสร็จสิ้น ${completedCount} รายการ</b>\n` +
      `👷 ช่าง: ${technician || '-'}\n` +
      `📅 วันที่: ${toThaiDisplay(todayStr)}`
    );

    res.json({ success: true, completedCount });
  } catch (err) {
    console.error('POST /inspections/batch-complete error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด: ' + err.message });
  }
});

module.exports = router;
