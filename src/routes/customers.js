const express = require('express');
const sheets = require('../services/googleSheets');
const audit = require('../services/auditLog');
const config = require('../config');
const { toISO, addYears, addMonths, nowISO, daysBetween, today } = require('../utils/dateUtils');

const router = express.Router();

// คอลัมน์ลูกค้า (เพิ่ม พื้นที่ตร.ม. ที่ index 5)
// 0:รหัส 1:ชื่อ 2:เบอร์โทร 3:ที่อยู่ 4:ลักษณะอาคาร 5:พื้นที่(ตร.ม.)
// 6:ลักษณะงาน 7:ราคา 8:วันทำสัญญา 9:วันหมดสัญญา
// 10:รอบรับประกัน(ปี) 11:รอบตรวจเช็ค(เดือน) 12:สถานะ 13:หมายเหตุ
// 14:created_at 15:updated_at

function rowToCustomer(row, index) {
  return {
    id: row[0] || '',
    name: row[1] || '',
    phone: row[2] || '',
    address: row[3] || '',
    buildingType: row[4] || '',
    area: row[5] || '',
    jobType: row[6] || '',
    price: row[7] || '',
    contractStart: row[8] || '',
    contractEnd: row[9] || '',
    warrantyYears: row[10] || '',
    inspectionIntervalMonths: row[11] || '',
    status: row[12] || 'active',
    notes: row[13] || '',
    createdAt: row[14] || '',
    updatedAt: row[15] || '',
    _rowIndex: index + 1,
  };
}

// GET /api/customers
router.get('/', async (req, res) => {
  try {
    const rows = await sheets.getRows(config.sheets.customers);
    if (rows.length <= 1) return res.json([]);

    let customers = rows.slice(1).map((row, i) => rowToCustomer(row, i + 1));

    if (req.query.status && req.query.status !== 'all') {
      customers = customers.filter(c => c.status === req.query.status);
    }

    if (req.query.search) {
      const q = req.query.search.toLowerCase();
      customers = customers.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        c.address.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q)
      );
    }

    const inspRows = await sheets.getRows(config.sheets.inspections);
    const now = today();

    customers = customers.map(c => {
      const custInspections = inspRows.slice(1)
        .filter(r => r[1] === c.id)
        .map(r => ({
          id: r[0], round: r[2], dueDate: r[3], actualDate: r[4], status: r[5],
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

    const inspRows = await sheets.getRows(config.sheets.inspections);
    customer.inspections = inspRows.slice(1)
      .filter(r => r[1] === customer.id)
      .map(r => ({
        id: r[0], round: r[2], dueDate: r[3], actualDate: r[4],
        status: r[5], result: r[6], technician: r[7], photos: r[8],
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
      name, phone, address, buildingType, area, jobType, price,
      contractStart, warrantyYears, inspectionIntervalMonths, notes,
    } = req.body;

    if (!name || !contractStart) {
      return res.status(400).json({ error: 'กรุณากรอกชื่อและวันทำสัญญา' });
    }

    const id = await sheets.generateId(config.sheets.customers, 'C');
    const warranty = parseInt(warrantyYears) || 0;
    const contractEnd = warranty > 0 ? toISO(addYears(contractStart, warranty)) : '';
    const now = nowISO();

    const customerRow = [
      id, name, phone || '', address || '', buildingType || '',
      area || '', jobType || '', price || '', contractStart, contractEnd,
      warrantyYears || '0', inspectionIntervalMonths || '4',
      'active', notes || '', now, now,
    ];

    await sheets.appendRow(config.sheets.customers, customerRow);

    // สร้างตารางตรวจเช็คอัตโนมัติ (เฉพาะกรณีมีรับประกัน)
    let inspectionsCreated = 0;
    if (warranty > 0) {
      const interval = parseInt(inspectionIntervalMonths) || 4;
      const totalRounds = Math.floor((warranty * 12) / interval);
      const inspectionRows = [];

      for (let i = 1; i <= totalRounds; i++) {
        const insId = await sheets.generateId(config.sheets.inspections, 'INS');
        const dueDate = toISO(addMonths(contractStart, i * interval));
        inspectionRows.push([
          insId, id, String(i), dueDate, '', 'pending', '', '', '', now, now,
        ]);
      }

      if (inspectionRows.length > 0) {
        await sheets.appendRows(config.sheets.inspections, inspectionRows);
        inspectionsCreated = inspectionRows.length;
      }
    }

    await audit.log('create', 'customer', id, { name, phone, address, area }, req.user?.displayName || 'admin');

    res.json({
      success: true,
      customer: { id, name, contractEnd },
      inspectionsCreated,
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
      name, phone, address, buildingType, area, jobType, price,
      contractStart, warrantyYears, inspectionIntervalMonths,
      status, notes,
    } = req.body;

    const warranty = parseInt(warrantyYears ?? old.warrantyYears) || 0;
    const startDate = contractStart ?? old.contractStart;
    const contractEnd = (warranty > 0 && startDate)
      ? toISO(addYears(startDate, warranty))
      : (warranty === 0 ? '' : old.contractEnd);

    const updatedRow = [
      req.params.id,
      name ?? old.name,
      phone ?? old.phone,
      address ?? old.address,
      buildingType ?? old.buildingType,
      area ?? old.area,
      jobType ?? old.jobType,
      price ?? old.price,
      startDate,
      contractEnd,
      warrantyYears ?? old.warrantyYears,
      inspectionIntervalMonths ?? old.inspectionIntervalMonths,
      status ?? old.status,
      notes ?? old.notes,
      old.createdAt,
      nowISO(),
    ];

    await sheets.updateRow(config.sheets.customers, rowIndex, updatedRow);

    const changes = {};
    const fields = ['name', 'phone', 'address', 'buildingType', 'area', 'jobType', 'price',
      'contractStart', 'status', 'notes'];
    fields.forEach(f => {
      if (req.body[f] !== undefined && req.body[f] !== old[f]) {
        changes[f] = { from: old[f], to: req.body[f] };
      }
    });

    if (Object.keys(changes).length > 0) {
      await audit.log('update', 'customer', req.params.id, changes, req.user?.displayName || 'admin');
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

    const warranty = parseInt(warrantyYears);
    const newContractEnd = warranty > 0 ? toISO(addYears(newContractStart, warranty)) : '';
    const interval = parseInt(inspectionIntervalMonths) || parseInt(oldRow[11]) || 4;
    const now = nowISO();

    // อัพเดทข้อมูลสัญญา
    oldRow[8] = newContractStart;
    oldRow[9] = newContractEnd;
    oldRow[10] = warrantyYears;
    oldRow[11] = String(interval);
    oldRow[12] = 'active';
    oldRow[15] = now;

    await sheets.updateRow(config.sheets.customers, rowIndex, oldRow);

    // สร้างตารางตรวจเช็คใหม่ (เฉพาะกรณีมีรับประกัน)
    let inspectionsCreated = 0;
    if (warranty > 0) {
      const totalRounds = Math.floor((warranty * 12) / interval);
      const inspectionRows = [];

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
        inspectionsCreated = inspectionRows.length;
      }
    }

    await audit.log('renew', 'customer', req.params.id, {
      newContractStart, newContractEnd: newContractEnd || 'ไม่รับประกัน', warrantyYears,
    }, req.user?.displayName || 'admin');

    res.json({ success: true, contractEnd: newContractEnd, inspectionsCreated });
  } catch (err) {
    console.error('POST /customers/:id/renew error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด: ' + err.message });
  }
});

module.exports = router;
