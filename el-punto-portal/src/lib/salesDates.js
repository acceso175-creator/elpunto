export function salesDateRange(startDate, endDate = startDate) {
  const valid = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value;
  if (!valid(startDate) || !valid(endDate) || startDate > endDate) throw new Error('Elige un rango de fechas válido.');
  const next = new Date(`${endDate}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return { startDate: `${startDate}T00:00:00-06:00`, endDate: `${next.toISOString().slice(0,10)}T00:00:00-06:00` };
}
