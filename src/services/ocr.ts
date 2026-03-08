export type OcrNamecardData = {
  name: string | null;
  company: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
};

function normalizeField(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeOcrResponse(payload: unknown): OcrNamecardData {
  const data = (payload ?? {}) as Record<string, unknown>;
  return {
    name: normalizeField(data.name),
    company: normalizeField(data.company),
    title: normalizeField(data.title),
    email: normalizeField(data.email),
    phone: normalizeField(data.phone)
  };
}

export async function extractNamecardData(imageDataUrl: string): Promise<OcrNamecardData> {
  const response = await fetch('/api/ocr/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageDataUrl })
  });

  if (!response.ok) {
    throw new Error(`OCR request failed: ${response.status}`);
  }

  const payload = await response.json();
  return normalizeOcrResponse(payload);
}
