const express = require('express');
const multer = require('multer');
const sheets = require('../services/googleSheets');
const audit = require('../services/auditLog');
const telegram = require('../services/telegram');
const config = require('../config');
const { toISO, nowISO, today, daysBetween, toThaiDisplay } = require('../utils/dateUtils');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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

      // อัพเดทสถานะ overdue อัตโนมัติ
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

    // ดึงข้อมูลลูกค้า
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

    const { result, technician } = req.body;
    const now = nowISO();
    const todayStr = toISO(today());

    oldRow[4] = todayStr; // วันตรวจจริง
    oldRow[5] = 'completed'; // สถานะ
    oldRow[6] = result || oldRow[6] || ''; // ผลการตรวจ
    oldRow[7] = technician || oldRow[7] || ''; // ช่างผู้ตรวจ
    oldRow[10] = now; // updated_at

    await sheets.updateRow(config.sheets.inspections, rowIndex, oldRow);

    await audit.log('complete', 'inspection', req.params.id, {
      actualDate: todayStr, result, technician,
    }, 'user');

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

    await audit.log('update', 'inspection', req.params.id, req.body, 'user');

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

    // เพิ่มลิงก์รูปใหม่ต่อท้ายลิงก์เดิม
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
    const { ids, technician, result } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'กรุณาเลือกรายการ' });
    }

    const inspRows = await sheets.getRows(config.sheets.inspections);
    const now = nowISO();
    const todayStr = toISO(today());
    let completedCount = 0;

    for (const id of ids) {
      for (let i = 1; i < inspRows.length; i++) {
        if (inspRows[i][0] === id) {
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
    }, 'user');

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
