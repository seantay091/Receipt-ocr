import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { RECEIPTS_BUCKET } from "@/lib/supabase/env";
import { getHousehold } from "@/lib/household";
import { extractText } from "@/lib/ocr";
import { parseReceipt, type DateOrder } from "@/lib/parse-receipt";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PATH_RE = new RegExp(`^(${UUID})/${UUID}\\.jpg$`);

// The browser uploads the photo straight to Supabase Storage (avoids Vercel's
// ~4.5 MB request body limit), then calls this route with the storage path.
// Interim flow until build step 3 (extract → review → save): it saves at once.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { path?: unknown; name?: unknown } | null;
  const path = typeof body?.path === "string" ? body.path : "";
  const originalName = typeof body?.name === "string" ? body.name.slice(0, 255) : null;

  const household = await getHousehold(supabase);
  if (PATH_RE.exec(path)?.[1] !== household.id) {
    return NextResponse.json({ error: "Invalid image path" }, { status: 400 });
  }

  const storage = supabase.storage.from(RECEIPTS_BUCKET);
  const { data: blob, error: downloadError } = await storage.download(path);
  if (downloadError || !blob) {
    return NextResponse.json({ error: `Could not read uploaded image: ${downloadError?.message}` }, { status: 400 });
  }
  const bytes = await blob.arrayBuffer();
  const sha256 = createHash("sha256").update(Buffer.from(bytes)).digest("hex");

  const { data: file, error: fileError } = await supabase
    .from("file")
    .insert({ sha256, storage_path: path, original_name: originalName, mime: blob.type || "image/jpeg", size: bytes.byteLength })
    .select("id")
    .single();
  if (fileError) {
    await storage.remove([path]);
    if (fileError.code === "23505") {
      return NextResponse.json({ error: "This photo has already been uploaded." }, { status: 409 });
    }
    return NextResponse.json({ error: fileError.message }, { status: 500 });
  }

  // If OCR fails we still save the receipt so the user can type the details in.
  let rawText: string | null = null;
  let ocrError: string | null = null;
  try {
    rawText = await extractText(bytes);
  } catch (e) {
    ocrError = e instanceof Error ? e.message : String(e);
    console.error("OCR failed:", ocrError);
  }

  const dateOrder: DateOrder = process.env.RECEIPT_DATE_ORDER === "MDY" ? "MDY" : "DMY";
  const parsed = rawText ? parseReceipt(rawText, { dateOrder }) : null;

  const { data: receipt, error: insertError } = await supabase
    .from("receipt")
    .insert({
      file_id: file.id,
      ocr_engine: "vision",
      raw_text: rawText,
      store_name: parsed?.merchant ?? null,
      purchase_date: parsed?.purchaseDate ?? null,
      total: parsed?.total ?? null,
      currency: parsed?.currency ?? household.default_currency,
    })
    .select()
    .single();

  if (insertError) {
    await supabase.from("file").delete().eq("id", file.id);
    await storage.remove([path]);
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }
  return NextResponse.json({ receipt, ocrError });
}
