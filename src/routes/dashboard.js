const express = require('express');
const sheets = require('../services/googleSheets');
const config = require('../config');
const { today, daysBetween } = require('../utils/dateUtils');

const router = express.Router();

// GET /api/dashboard/stats
router.get('/stats', async (req, res) => {
  try {
    const [custRows, inspRows] = await Promise.all([
      sheets.getRows(config.sheets.customers),
      sheets.getRows(config.sheets.inspections),
    ]);

    const now = today();
    const customers = custRows.slice(1);
    const inspections = inspRows.slice(1);

    // สถิติลูกค้า
    const totalCustomers = customers.length;
    const activeCustomers = customers.filter(r => r[12] === 'active').length;

    // สถิติตรวจเช็ค
    let pendingCount = 0;
    let overdueCount = 0;
    let todayCount = 0;
    const upcomingInspections = [];
    const overdueInspections = [];

    inspections.forEach(row => {
      const status = row[5];
      let dueDate = null;
      if (row[3]) {
        const p = row[3].split('-');
        if (p.length >= 3) dueDate = new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
      }
      const days = dueDate ? daysBetween(now, dueDate) : null;

      // ดึงชื่อลูกค้า
      const customer = customers.find(c => c[0] === row[1]);
      const customerName = customer ? customer[1] : row[1];

      if (status === 'pending' || status === 'overdue') {
        if (dueDate && dueDate < now) {
          overdueCount++;
          overdueInspections.push({
            id: row[0],
            customerId: row[1],
            customerName,
            round: row[2],
            dueDate: row[3],
            daysOverdue: Math.abs(days),
          });
        } else {
          pendingCount++;
          if (days === 0) todayCount++;

          if (days !== null && days >= 0 && days <= 7) {
            upcomingInspections.push({
              id: row[0],
              customerId: row[1],
              customerName,
              round: row[2],
              dueDate: row[3],
              daysUntilDue: days,
            });
          }
        }
      }
    });

    // สัญญาใกล้หมด (90 วัน)
    const expiringContracts = [];
    customers.forEach(row => {
      if (row[12] !== 'active') return; // index 12 = สถานะ
      let contractEnd = null;
      if (row[9]) {
        const p = row[9].split('-');
        if (p.length >= 3) contractEnd = new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
      }
      if (!contractEnd) return;
      const days = daysBetween(now, contractEnd);
      if (days >= 0 && days <= 90) {
        expiringContracts.push({
          id: row[0],
          name: row[1],
          contractEnd: row[9],
          daysToExpiry: days,
        });
      }
    });

    // ข้อมูลปฏิทิน (ทุกเดือน — frontend จะกรองเอง)
    const calendarEvents = [];

    inspections.forEach(row => {
      if (!row[3]) return;
      // แยก date string ตรงๆ ไม่ใช้ new Date เพื่อหลีกเลี่ยง timezone
      const parts = row[3].split('-');
      if (parts.length < 3) return;
      const y = parseInt(parts[0]);
      const m = parseInt(parts[1]) - 1;
      const d = parseInt(parts[2]);
      const dueDate = new Date(y, m, d);

      const customer = customers.find(c => c[0] === row[1]);
      calendarEvents.push({
        id: row[0],
        customerId: row[1],
        customerName: customer ? customer[1] : row[1],
        round: row[2],
        date: row[3],
        year: y,
        month: m,
        day: d,
        status: row[5] === 'completed' ? 'completed' : (dueDate < now ? 'overdue' : 'pending'),
      });
    });

    // เรียงลำดับ
    upcomingInspections.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
    overdueInspections.sort((a, b) => b.daysOverdue - a.daysOverdue);
    expiringContracts.sort((a, b) => a.daysToExpiry - b.daysToExpiry);

    res.json({
      stats: {
        totalCustomers,
        activeCustomers,
        pendingInspections: pendingCount,
        overdueInspections: overdueCount,
        todayInspections: todayCount,
        expiringContracts: expiringContracts.length,
      },
      upcomingInspections,
      overdueInspections,
      expiringContracts,
      calendarEvents,
    });
  } catch (err) {
    console.error('GET /dashboard/stats error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด: ' + err.message });
  }
});

module.exports = router;
