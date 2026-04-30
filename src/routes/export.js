const express = require('express');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const path = require('path');
const sheets = require('../services/googleSheets');
const config = require('../config');
const { toThaiDisplay, today, daysBetween } = require('../utils/dateUtils');

const router = express.Router();
const FONT_PATH = path.join(__dirname, '../../public/fonts/NotoSansThai-Regular.ttf');

// GET /api/export/customers?format=excel|pdf&status=active|expired|all
router.get('/customers', async (req, res) => {
  try {
    const format = req.query.format || 'excel';
    const statusFilter = req.query.status || 'all';

    const rows = await sheets.getRows(config.sheets.customers);
    let customers = rows.slice(1);

    if (statusFilter !== 'all') {
      customers = customers.filter(r => r[12] === statusFilter);
    }

    if (format === 'pdf') {
      return exportCustomersPDF(res, customers);
    }
    return exportCustomersExcel(res, customers);
  } catch (err) {
    console.error('Export customers error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด: ' + err.message });
  }
});

// GET /api/export/inspections?format=excel&from=&to=&status=
router.get('/inspections', async (req, res) => {
  try {
    const { from, to, status, customerId } = req.query;

    const [inspRows, custRows] = await Promise.all([
      sheets.getRows(config.sheets.inspections),
      sheets.getRows(config.sheets.customers),
    ]);

    const customerMap = {};
    custRows.slice(1).forEach(r => { customerMap[r[0]] = r[1]; });

    let inspections = inspRows.slice(1);

    if (status && status !== 'all') {
      inspections = inspections.filter(r => r[5] === status);
    }
    if (from) inspections = inspections.filter(r => r[3] >= from);
    if (to) inspections = inspections.filter(r => r[3] <= to);
    if (customerId) inspections = inspections.filter(r => r[1] === customerId);

    return exportInspectionsExcel(res, inspections, customerMap);
  } catch (err) {
    console.error('Export inspections error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด: ' + err.message });
  }
});

// GET /api/export/customer/:id - รายงานลูกค้ารายบุคคล PDF
router.get('/customer/:id', async (req, res) => {
  try {
    const [custRows, inspRows] = await Promise.all([
      sheets.getRows(config.sheets.customers),
      sheets.getRows(config.sheets.inspections),
    ]);

    const custRow = custRows.find((r, i) => i > 0 && r[0] === req.params.id);
    if (!custRow) return res.status(404).json({ error: 'ไม่พบลูกค้า' });

    const inspections = inspRows.slice(1).filter(r => r[1] === req.params.id);

    return exportCustomerReportPDF(res, custRow, inspections);
  } catch (err) {
    console.error('Export customer report error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด: ' + err.message });
  }
});

async function exportCustomersExcel(res, customers) {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('รายชื่อลูกค้า');

  ws.columns = [
    { header: 'รหัส', key: 'id', width: 10 },
    { header: 'ชื่อ', key: 'name', width: 25 },
    { header: 'เบอร์โทร', key: 'phone', width: 15 },
    { header: 'ที่อยู่', key: 'address', width: 35 },
    { header: 'ลักษณะอาคาร', key: 'building', width: 20 },
    { header: 'พื้นที่(ตร.ม.)', key: 'area', width: 14 },
    { header: 'ลักษณะงาน', key: 'job', width: 20 },
    { header: 'ราคา', key: 'price', width: 12 },
    { header: 'วันทำสัญญา', key: 'start', width: 15 },
    { header: 'วันหมดสัญญา', key: 'end', width: 15 },
    { header: 'สถานะ', key: 'status', width: 12 },
  ];

  // Style header
  ws.getRow(1).eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B4332' } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  });

  customers.forEach(r => {
    const statusMap = { active: 'ใช้งาน', expired: 'หมดสัญญา', cancelled: 'ยกเลิก' };
    ws.addRow({
      id: r[0], name: r[1], phone: r[2], address: r[3],
      building: r[4], area: r[5], job: r[6], price: r[7],
      start: toThaiDisplay(r[8]), end: r[9] ? toThaiDisplay(r[9]) : 'ไม่รับประกัน',
      status: statusMap[r[12]] || r[12],
    });
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=customers.xlsx');
  await workbook.xlsx.write(res);
  res.end();
}

function exportCustomersPDF(res, customers) {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename=customers.pdf');
  doc.pipe(res);

  doc.font(FONT_PATH);
  doc.fontSize(18).text('รายชื่อลูกค้า', { align: 'center' });
  doc.fontSize(10).text(`วันที่พิมพ์: ${toThaiDisplay(today())}`, { align: 'center' });
  doc.moveDown();

  const headers = ['รหัส', 'ชื่อ', 'เบอร์โทร', 'ที่อยู่', 'งาน', 'ราคา', 'หมดสัญญา', 'สถานะ'];
  const colWidths = [50, 120, 80, 160, 100, 60, 80, 60];
  let y = doc.y;
  let x = 30;

  // Header
  doc.fontSize(9).font(FONT_PATH);
  headers.forEach((h, i) => {
    doc.rect(x, y, colWidths[i], 20).fill('#1B4332');
    doc.fill('#FFFFFF').text(h, x + 3, y + 5, { width: colWidths[i] - 6 });
    x += colWidths[i];
  });

  y += 20;
  doc.fill('#000000');

  customers.forEach((r, rowIdx) => {
    if (y > 540) {
      doc.addPage();
      y = 30;
    }

    x = 30;
    const bgColor = rowIdx % 2 === 0 ? '#FFFFFF' : '#F3F4F6';
    const statusMap = { active: 'ใช้งาน', expired: 'หมดสัญญา', cancelled: 'ยกเลิก' };
    const vals = [r[0], r[1], r[2], r[3], r[6], r[7], r[9] ? toThaiDisplay(r[9]) : 'ไม่รับประกัน', statusMap[r[12]] || r[12]];

    vals.forEach((v, i) => {
      doc.rect(x, y, colWidths[i], 18).fill(bgColor);
      doc.fill('#000000').fontSize(8).text(v || '', x + 3, y + 4, { width: colWidths[i] - 6 });
      x += colWidths[i];
    });

    y += 18;
  });

  doc.end();
}

async function exportInspectionsExcel(res, inspections, customerMap) {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('รายงานตรวจเช็ค');

  ws.columns = [
    { header: 'รหัส', key: 'id', width: 12 },
    { header: 'ลูกค้า', key: 'customer', width: 25 },
    { header: 'รอบที่', key: 'round', width: 8 },
    { header: 'วันกำหนด', key: 'due', width: 15 },
    { header: 'วันตรวจจริง', key: 'actual', width: 15 },
    { header: 'สถานะ', key: 'status', width: 15 },
    { header: 'ผลการตรวจ', key: 'result', width: 25 },
    { header: 'ช่างผู้ตรวจ', key: 'tech', width: 15 },
  ];

  ws.getRow(1).eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B4332' } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  });

  const statusMap = { pending: 'รอดำเนินการ', completed: 'เสร็จสิ้น', overdue: 'เกินกำหนด' };

  inspections.forEach(r => {
    const row = ws.addRow({
      id: r[0],
      customer: customerMap[r[1]] || r[1],
      round: r[2],
      due: toThaiDisplay(r[3]),
      actual: toThaiDisplay(r[4]),
      status: statusMap[r[5]] || r[5],
      result: r[6],
      tech: r[7],
    });

    if (r[5] === 'overdue') {
      row.eachCell(cell => { cell.font = { color: { argb: 'FFDC2626' } }; });
    } else if (r[5] === 'completed') {
      row.eachCell(cell => { cell.font = { color: { argb: 'FF16A34A' } }; });
    }
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=inspections.xlsx');
  await workbook.xlsx.write(res);
  res.end();
}

function exportCustomerReportPDF(res, custRow, inspections) {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=customer_${custRow[0]}.pdf`);
  doc.pipe(res);

  doc.font(FONT_PATH);
  doc.fontSize(20).text('รายงานลูกค้า', { align: 'center' });
  doc.moveDown();

  // ข้อมูลลูกค้า
  doc.fontSize(14).text('ข้อมูลลูกค้า', { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(11);
  const info = [
    ['รหัส', custRow[0]], ['ชื่อ', custRow[1]],
    ['เบอร์โทร', custRow[2]], ['ที่อยู่', custRow[3]],
    ['ลักษณะอาคาร', custRow[4]], ['พื้นที่(ตร.ม.)', custRow[5]],
    ['ลักษณะงาน', custRow[6]], ['ราคา', custRow[7]],
    ['วันทำสัญญา', toThaiDisplay(custRow[8])],
    ['วันหมดสัญญา', custRow[9] ? toThaiDisplay(custRow[9]) : 'ไม่รับประกัน'],
  ];

  info.forEach(([label, value]) => {
    doc.text(`${label}: ${value || '-'}`);
  });

  doc.moveDown();
  doc.fontSize(14).text('ประวัติการตรวจเช็ค', { underline: true });
  doc.moveDown(0.5);

  const statusMap = { pending: 'รอดำเนินการ', completed: 'เสร็จสิ้น', overdue: 'เกินกำหนด' };

  if (inspections.length === 0) {
    doc.fontSize(11).text('ไม่มีข้อมูลการตรวจเช็ค');
  } else {
    inspections.forEach((r, i) => {
      doc.fontSize(10);
      doc.text(`รอบที่ ${r[2]} | กำหนด: ${toThaiDisplay(r[3])} | ตรวจจริง: ${toThaiDisplay(r[4]) || '-'} | สถานะ: ${statusMap[r[5]] || r[5]} | ช่าง: ${r[7] || '-'}`);
      if (r[6]) doc.text(`  ผลการตรวจ: ${r[6]}`);
    });
  }

  doc.end();
}

module.exports = router;
