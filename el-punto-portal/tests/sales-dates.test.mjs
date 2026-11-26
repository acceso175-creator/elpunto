import assert from 'node:assert/strict';
import { test } from 'node:test';
import { salesDateRange } from '../src/lib/salesDates.js';

test('daily cut ends exactly at next midnight in Chihuahua', () => {
  const range = salesDateRange('2026-11-25');
  assert.equal(new Date(range.startDate).toISOString(), '2026-11-25T06:00:00.000Z');
  assert.equal(new Date(range.endDate).toISOString(), '2026-11-26T06:00:00.000Z');
  assert.equal(new Date(range.endDate) - new Date(range.startDate), 86400000);
});
test('inclusive range handles leap day, month and year boundaries', () => {
  assert.equal(salesDateRange('2024-02-28','2024-02-29').endDate, '2024-03-01T00:00:00-06:00');
  assert.equal(salesDateRange('2026-12-31').endDate, '2027-01-01T00:00:00-06:00');
});
test('invalid or reversed dates are rejected before querying', () => {
  for (const dates of [['',''],['2026-02-30','2026-03-01'],['2026-11-26','2026-11-25'],['2026-2-1','2026-2-1']]) assert.throws(() => salesDateRange(...dates), /válido/);
});
