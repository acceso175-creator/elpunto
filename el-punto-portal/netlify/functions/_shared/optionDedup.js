export function normalizeOptionName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('es-MX');
}

export function optionDedupKey(option) {
  return `${normalizeOptionName(option?.name)}|${Number(option?.priceDelta ?? option?.price_delta ?? 0).toFixed(2)}`;
}

export function dedupeOptions(options = []) {
  const seen = new Set();
  return [...(Array.isArray(options) ? options : [])]
    .sort((a, b) => Number(a.sortOrder ?? a.sort_order ?? 0) - Number(b.sortOrder ?? b.sort_order ?? 0))
    .filter((option) => {
      const key = optionDedupKey(option);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function duplicateOptionNames(options = []) {
  const seen = new Map();
  const duplicates = new Set();
  (Array.isArray(options) ? options : []).forEach((option) => {
    const key = optionDedupKey(option);
    if (seen.has(key)) duplicates.add(String(option?.name || seen.get(key) || '').trim());
    else seen.set(key, option?.name);
  });
  return [...duplicates].filter(Boolean);
}
