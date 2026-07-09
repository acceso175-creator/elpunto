export function getParam(source, name) {
  if (!source) return undefined;
  const exact = source[name];
  if (exact !== undefined) return exact;
  const foundKey = Object.keys(source).find((key) => key.toLowerCase() === name.toLowerCase());
  return foundKey ? source[foundKey] : undefined;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function invalidUuidResponse(json, fieldName, value) {
  return json(400, {
    error: `${fieldName} inválido.`,
    [`received${fieldName.charAt(0).toUpperCase()}${fieldName.slice(1)}`]: value ? 'presente pero inválido' : 'ausente'
  });
}
