import "server-only";

// Google Cloud Vision — DOCUMENT_TEXT_DETECTION is tuned for dense text like receipts.
// Free tier: first 1,000 units / month (billing account must be enabled on the project).
export async function extractText(image: ArrayBuffer): Promise<string> {
  const apiKey = process.env.GOOGLE_VISION_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_VISION_API_KEY is not set");

  const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [
        {
          image: { content: Buffer.from(image).toString("base64") },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
        },
      ],
    }),
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Vision API ${res.status}: ${json?.error?.message ?? res.statusText}`);
  }
  const first = json?.responses?.[0];
  if (first?.error) throw new Error(`Vision API: ${first.error.message}`);
  return first?.fullTextAnnotation?.text ?? "";
}
