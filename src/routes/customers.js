const express = require('express');
const sheets = require('../services/googleSheets');
const audit = require('../services/auditLog');
const config = require('../config');
const { toISO, addYears, addMonths, nowISO, daysBetween, today } = require('../utils/dateUtils');

const router = express.Router();

// แปลงแถว Google Sheets → object ลูกค้า
function rowToCustomer(row, index) {
  return {
    id: row[0] || '',
    name: row[1] || '',
    phone: row[2] || '',
    address: row[3] || '',
    buildingType: row[4] || '',
    jobType: row[5] || '',
    price: row[6] || '',
    contractStart: row[7] || '',
    contractEnd: row[8] || '',
    warrantyYears: row[9] || '',
    inspectionIntervalMonths: row[10] || '',
    status: row[11] || 'active',
    notes: row[12] || '',
    createdAt: row[13] || '',
    updatedAt: row[14] || '',
    _rowIndex: index + 1, // 1-based สำหรับ Sheets API
  };
}

// GET /api/customers
router.get('/', async (req, res) => {
  try {
    const rows = await sheets.getRows(config.sheets.customers);
    if (rows.length <= 1) return res.json([]);

    let customers = rows.slice(1).map((row, i) => rowToCustomer(row, i + 1));

    // กรองตาม status
    if (req.query.status && req.query.status !== 'all') {
      customers = customers.filter(c => c.status === req.query.status);
    }

    // ค้นหา universal
    if (req.query.search) {
      const q = req.query.search.toLowerCase();
      customers = customers.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        c.address.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q)
      );
    }

    // เพิ่มข้อมูลสถานะตรวจเช็ค
    const inspRows = await sheets.getRows(config.sheets.inspections);
    const now = today();

    customers = customers.map(c => {
      const custInspections = inspRows.slice(1)
        .filter(r => r[1] === c.id)
        .map(r => ({
          id: r[0],
          round: r[2],
          dueDate: r[3],
          actualDate: r[4],
          status: r[5],
        }));

      const nextPending = custInspections
        .filter(ins => ins.status === 'pending' || ins.status === 'overdue')
        .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))[0];

      const contractEnd = c.contractEnd ? new Date(c.contractEnd) : null;
      const daysToExpiry = contractEnd ? daysBetween(now, contractEnd) : null;

      return {
        ...c,
        totalInspections: custInspections.length,
        completedInspections: custInspections.filter(i => i.status === 'completed').length,
        nextInspection: nextPending || null,
        daysToExpiry,
      };
    });

    res.json(customers);
  } catch (err) {
    console.error('GET /customers error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด: ' + err.message });
  }
});

// GET /api/customers/:id
router.get('/:id', async (req, res) => {
  try {
    const rows = await sheets.getRows(config.sheets.customers);
    const row = rows.find((r, i) => i > 0 && r[0] === req.params.id);
    if (!row) return res.status(404).json({ error: 'ไม่พบลูกค้า' });

    const index = rows.indexOf(row);
    const customer = rowToCustomer(row, index);

    // ดึงรายการตรวจเช็คของลูกค้า
    const inspRows = await sheets.getRows(config.sheets.inspections);
    customer.inspections = inspRows.slice(1)
      .filter(r => r[1] === customer.id)
      .map(r => ({
        id: r[0],
        round: r[2],
        dueDate: r[3],
        actualDate: r[4],
        status: r[5],
        result: r[6],
        technician: r[7],
        photos: r[8],
      }));

    res.json(customer);
  } catch (err) {
    console.error('GET /customers/:id error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด: ' + err.message });
  }
});

// POST /api/customers - เพิ่มลูกค้าใหม่
router.post('/', async (req, res) => {
  try {
    const {
      name, phone, address, buildingType, jobType, price,
      contractStart, warrantyYears, inspectionIntervalMonths, notes,
    } = req.body;

    if (!name || !contractStart || !warrantyYears) {
      return res.status(400).json({ error: 'กรุณากรอกข้อมูลที่จำเป็น' });
    }

    const id = await sheets.generateId(config.sheets.customers, 'C');
    const contractEnd = toISO(addYears(contractStart, parseInt(warrantyYears)));
    const now = nowISO();

    const customerRow = [
      id, name, phone || '', address || '', buildingType || '',
      jobType || '', price || '', contractStart, contractEnd,
      warrantyYears, inspectionIntervalMonths || '4',
      'active', notes || '', now, now,
    ];

    await sheets.appendRow(config.sheets.customers, customerRow);

    // สร้างตารางตรวจเช็คอัตโนมัติ
    const interval = parseInt(inspectionIntervalMonths) || 4;
    const totalRounds = Math.floor((parseInt(warrantyYears) * 12) / interval);
    const inspectionRows = [];

    for (let i = 1; i <= totalRounds; i++) {
      const insId = await sheets.generateId(config.sheets.inspections, 'INS');
      const dueDate = toISO(addMonths(contractStart, i * interval));

      inspectionRows.push([
        insId, id, String(i), dueDate, '', 'pending',
        '', '', '', now, now,
      ]);
    }

    if (inspectionRows.length > 0) {
      await sheets.appendRows(config.sheets.inspections, inspectionRows);
    }

    await audit.log('create', 'customer', id, { name, phone, address }, 'user');

    res.json({
      success: true,
      customer: { id, name, contractEnd },
      inspectionsCreated: inspectionRows.length,
    });
  } catch (err) {
    console.error('POST /customers error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด: ' + err.message });
  }
});

// PUT /api/customers/:id - แก้ไขลูกค้า
router.put('/:id', async (req, res) => {
  try {
    const rows = await sheets.getRows(config.sheets.customers);
    let rowIndex = -1;
    let oldRow = null;

    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === req.params.id) {
        rowIndex = i + 1;
        oldRow = rows[i];
        break;
      }
    }

    if (rowIndex === -1) return res.status(404).json({ error: 'ไม่พบลูกค้า' });

    const old = rowToCustomer(oldRow, rowIndex - 1);
    const {
      name, phone, address, buildingType, jobType, price,
      contractStart, warrantyYears, inspectionIntervalMonths,
      status, notes,
    } = req.body;

    const contractEnd = (contractStart && warrantyYears)
      ? toISO(addYears(contractStart, parseInt(warrantyYears)))
      : old.contractEnd;

    const updatedRow = [
      req.params.id,
      name ?? old.name,
      phone ?? old.phone,
      address ?? old.address,
      buildingType ?? old.buildingType,
      jobType ?? old.jobType,
      price ?? old.price,
      contractStart ?? old.contractStart,
      contractEnd,
      warrantyYears ?? old.warrantyYears,
      inspectionIntervalMonths ?? old.inspectionIntervalMonths,
      status ?? old.status,
      notes ?? old.notes,
      old.createdAt,
      nowISO(),
    ];

    await sheets.updateRow(config.sheets.customers, rowIndex, updatedRow);

    // บันทึกการแก้ไข
    const changes = {};
    const fields = ['name', 'phone', 'address', 'buildingType', 'jobType', 'price',
      'contractStart', 'status', 'notes'];
    fields.forEach(f => {
      if (req.body[f] !== undefined && req.body[f] !== old[f]) {
        changes[f] = { from: old[f], to: req.body[f] };
      }
    });

    if (Object.keys(changes).length > 0) {
      await audit.log('update', 'customer', req.params.id, changes, 'user');
    }

    res.json({ success: true, customer: rowToCustomer(updatedRow, rowIndex - 1) });
  } catch (err) {
    console.error('PUT /customers/:id error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด: ' + err.message });
  }
});

// POST /api/customers/:id/renew - ต่อสัญญา
router.post('/:id/renew', async (req, res) => {
  try {
    const rows = await sheets.getRows(config.sheets.customers);
    let rowIndex = -1;
    let oldRow = null;

    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === req.params.id) {
        rowIndex = i + 1;
        oldRow = rows[i];
        break;
      }
    }

    if (rowIndex === -1) return res.status(404).json({ error: 'ไม่พบลูกค้า' });

    const { newContractStart, warrantyYears, inspectionIntervalMonths } = req.body;
    if (!newContractStart || !warrantyYears) {
      return res.status(400).json({ error: 'กรุณากรอกวันทำสัญญาใหม่และรอบรับประกัน' });
    }

    const newContractEnd = toISO(addYears(newContractStart, parseInt(warrantyYears)));
    const interval = parseInt(inspectionIntervalMonths) || parseInt(oldRow[10]) || 4;
    const now = nowISO();

    // อัพเดทข้อมูลสัญญา
    oldRow[7] = newContractStart;
    oldRow[8] = newContractEnd;
    oldRow[9] = warrantyYears;
    oldRow[10] = String(interval);
    oldRow[11] = 'active';
    oldRow[14] = now;

    await sheets.updateRow(config.sheets.customers, rowIndex, oldRow);

    // สร้างตารางตรวจเช็คใหม่
    const totalRounds = Math.floor((parseInt(warrantyYears) * 12) / interval);
    const inspectionRows = [];

    // หา round สูงสุดที่มีอยู่แล้ว
    const inspRows = await sheets.getRows(config.sheets.inspections);
    let maxRound = 0;
    inspRows.slice(1).forEach(r => {
      if (r[1] === req.params.id) {
        const round = parseInt(r[2]) || 0;
        if (round > maxRound) maxRound = round;
      }
    });

    for (let i = 1; i <= totalRounds; i++) {
      const insId = await sheets.generateId(config.sheets.inspections, 'INS');
      const dueDate = toISO(addMonths(newContractStart, i * interval));

      inspectionRows.push([
        insId, req.params.id, String(maxRound + i), dueDate, '', 'pending',
        '', '', '', now, now,
      ]);
    }

    if (inspectionRows.length > 0) {
      await sheets.appendRows(config.sheets.inspections, inspectionRows);
    }

    await audit.log('renew', 'customer', req.params.id, {
      newContractStart, newContractEnd, warrantyYears,
    }, 'user');

    res.json({
      success: true,
      contractEnd: newContractEnd,
      inspectionsCreated: inspectionRows.length,
    });
  } catch (err) {
    console.error('POST /customers/:id/renew error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด: ' + err.message });
  }
});

module.exports = router;
