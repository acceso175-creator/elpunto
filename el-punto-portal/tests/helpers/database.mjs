import { randomUUID } from 'node:crypto';

export function createDatabase(seed = {}, { fail = () => null } = {}) {
  const state = structuredClone(seed);
  let clock = 0;
  const calls = [];
  class Query {
    constructor(table) { this.table = table; this.action = 'select'; this.filters = []; this.sorting = []; this.fields = '*'; }
    select(fields = '*') { this.fields = fields; return this; }
    insert(payload) { this.action = 'insert'; this.payload = Array.isArray(payload) ? payload : [payload]; return this; }
    update(payload) { this.action = 'update'; this.payload = payload; return this; }
    upsert(payload) { this.action = 'upsert'; this.payload = Array.isArray(payload) ? payload : [payload]; return this; }
    delete() { this.action = 'delete'; return this; }
    eq(key, value) { this.filters.push((row) => row[key] === value); return this; }
    in(key, values) { this.filters.push((row) => values.includes(row[key])); return this; }
    gte(key, value) { this.filters.push((row) => new Date(row[key]) >= new Date(value)); return this; }
    lt(key, value) { this.filters.push((row) => new Date(row[key]) < new Date(value)); return this; }
    or(value) { const terms = value.split(',').map((term) => term.split('.eq.')); this.filters.push((row) => terms.some(([key, expected]) => row[key] === expected)); return this; }
    order(key, { ascending = true } = {}) { this.sorting.push({ key, ascending }); return this; }
    range(from, to) { this.bounds = [from,to]; return this; }
    limit(count) { this.bounds = [0,count-1]; return this; }
    async single() { const result = await this.execute(); if (result.error) return result; return result.data?.length === 1 ? { data: result.data[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'Expected one row' } }; }
    async maybeSingle() { const result = await this.execute(); if (result.error) return result; return result.data?.length <= 1 ? { data: result.data[0] || null, error: null } : { data: null, error: { message: 'Expected at most one row' } }; }
    then(resolve, reject) { return this.execute().then(resolve, reject); }
    async execute() {
      calls.push({ table: this.table, action: this.action, payload: structuredClone(this.payload) });
      const error = fail(this);
      if (error) return { data: null, error };
      const rows = state[this.table] ||= [];
      const matches = (row) => this.filters.every((filter) => filter(row));
      let result;
      if (this.action === 'insert') {
        const incoming = this.payload.map((row) => ({ id: randomUUID(), created_at: '2026-11-25T16:00:00Z', updated_at: `2026-11-25T16:00:${String(++clock).padStart(2,'0')}Z`, ...(this.table === 'admin_orders' ? { order_number: `ADM-${clock}` } : {}), ...row }));
        if (incoming.some((row) => rows.some((old) => old.id === row.id || row.order_number && old.order_number === row.order_number))) return { data: null, error: { code: '23505', message: 'Duplicate order' } };
        rows.push(...incoming); result = incoming;
      } else if (this.action === 'update') {
        result = rows.filter(matches);
        result.forEach((row) => Object.assign(row, this.payload, { updated_at: `2026-11-25T17:00:${String(++clock).padStart(2,'0')}Z` }));
      } else if (this.action === 'upsert') {
        result = this.payload;
        for (const row of result) { const old = rows.find((value) => value.id === row.id); if (old) Object.assign(old,row); else rows.push(structuredClone(row)); }
      } else if (this.action === 'delete') {
        result = rows.filter(matches);
        state[this.table] = rows.filter((row) => !matches(row));
      } else {
        result = rows.filter(matches);
        result.sort((a,b) => { for (const { key, ascending } of this.sorting) { const comparison = String(a[key]).localeCompare(String(b[key])); if (comparison) return ascending ? comparison : -comparison; } return 0; });
        if (this.bounds) result = result.slice(this.bounds[0],this.bounds[1]+1);
      }
      const output = structuredClone(result);
      if (this.fields.includes('admin_order_items(')) output.forEach((row) => { row.admin_order_items = structuredClone((state.admin_order_items || []).filter((item) => item.order_id === row.id)); });
      if (this.fields.includes('order_items(') && !this.fields.includes('admin_order_items(')) output.forEach((row) => { row.order_items = structuredClone((state.order_items || []).filter((item) => item.order_id === row.id)); });
      if (this.fields.includes('order_edit_history(')) output.forEach((row) => { row.order_edit_history = structuredClone((state.order_edit_history || []).filter((item) => item.order_id === row.id)); });
      return { data: output, error: null };
    }
  }
  return { from: (table) => new Query(table), state, calls };
}
