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


function effectiveOptionGroupSortOrder(group) {
  const raw = Number(group?.sortOrder ?? group?.sort_order ?? 0);
  if (!group?.required && Boolean(group?.templateId ?? group?.template_id) && raw === 0) return 100;
  return Number.isFinite(raw) ? raw : 0;
}

export function sortOptionGroups(groups = []) {
  return [...(Array.isArray(groups) ? groups : [])].sort((a, b) => {
    const requiredDiff = Number(Boolean(b.required)) - Number(Boolean(a.required));
    if (requiredDiff !== 0) return requiredDiff;
    const orderDiff = effectiveOptionGroupSortOrder(a) - effectiveOptionGroupSortOrder(b);
    if (orderDiff !== 0) return orderDiff;
    const aTemplate = Boolean(a.templateId ?? a.template_id);
    const bTemplate = Boolean(b.templateId ?? b.template_id);
    return Number(aTemplate) - Number(bTemplate);
  });
}
