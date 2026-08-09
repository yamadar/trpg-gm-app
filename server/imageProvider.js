const GEMINI_TIMEOUT_MS = 120000;

export async function generateImage({ prompt, apiKey, model, fetchImpl = fetch, referenceImages = [] }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  // 参照画像ごとに人物名ラベルを付け、どの画像が誰かをモデルへ明示する。
  // 最後にシーン全体のテキスト指示を置く。
  const requestParts = [
    ...referenceImages.flatMap((r, index) => [
      { text: `参照画像${index + 1}の人物名: ${String(r.name || `人物${index + 1}`)}` },
      { inlineData: { data: r.base64, mimeType: r.mimeType || 'image/png' } },
    ]),
    { text: prompt },
  ];
  const upstream = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ parts: requestParts }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    }),
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
  });
  if (!upstream.ok) {
    const t = await upstream.text().catch(() => '');
    throw new Error(`gemini image request failed: ${upstream.status} ${t.slice(0, 200)}`);
  }
  const data = await upstream.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find((p) => p?.inlineData?.data);
  if (!imgPart) throw new Error('gemini response contained no image');
  return { base64: imgPart.inlineData.data, mimeType: imgPart.inlineData.mimeType || 'image/png' };
}
