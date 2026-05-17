export function unwrapSafeStorageValue(value) {
  if (
    value
    && typeof value === 'object'
    && !Buffer.isBuffer(value)
    && !ArrayBuffer.isView(value)
    && !(value instanceof ArrayBuffer)
  ) {
    if (Object.prototype.hasOwnProperty.call(value, 'result')) return value.result;
    if (Object.prototype.hasOwnProperty.call(value, 'value')) return value.value;
  }

  return value;
}

export function normalizeApiKey(apiKey) {
  apiKey = unwrapSafeStorageValue(apiKey);
  let clean = '';
  if (Buffer.isBuffer(apiKey)) {
    clean = apiKey.toString('utf-8');
  } else if (ArrayBuffer.isView(apiKey)) {
    clean = Buffer
      .from(apiKey.buffer, apiKey.byteOffset, apiKey.byteLength)
      .toString('utf-8');
  } else if (apiKey instanceof ArrayBuffer) {
    clean = Buffer.from(apiKey).toString('utf-8');
  } else {
    clean = String(apiKey || '');
  }

  clean = clean.trim();
  if (clean.toLowerCase().startsWith('bearer ')) {
    clean = clean.slice(7).trim();
  }

  return clean.replace(/^["']|["']$/g, '').trim();
}

export function assertApiKeyShape(apiKey) {
  const clean = normalizeApiKey(apiKey);
  if (!clean) throw new Error('OpenAI API key is not configured');
  if (!clean.startsWith('sk-')) {
    throw new Error('OpenAI API key must start with sk-. Paste only the key, not the Authorization header.');
  }
  return clean;
}
