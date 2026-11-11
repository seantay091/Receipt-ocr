import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { RECEIPTS_BUCKET } from "@/lib/supabase/env";
import { extractText } from "@/lib/ocr";
import { parseReceipt, type DateOrder } from "@/lib/parse-receipt";

// The browser uploads the photo straight to Supabase Storage (avoids Vercel's
// ~4.5 MB request body limit), then calls this route with the storage path.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { path?: unknown; group?: unknown } | null;
  const path = typeof body?.path === "string" ? body.path : "";
  const group = typeof body?.group === "string" && body.group.trim() ? body.group.trim().slice(0, 60) : null;

  if (!path.startsWith(`${user.id}/`) || path.includes("..")) {
    return NextResponse.json({ error: "Invalid image path" }, { status: 400 });
  }

  const { data: file, error: downloadError } = await supabase.storage.from(RECEIPTS_BUCKET).download(path);
  if (downloadError || !file) {
    return NextResponse.json({ error: `Could not read uploaded image: ${downloadError?.message}` }, { status: 400 });
  }

  // If OCR fails we still save the receipt so the user can type the details in.
  let rawText: string | null = null;
  let ocrError: string | null = null;
  try {
    rawText = await extractText(await file.arrayBuffer());
  } catch (e) {
    ocrError = e instanceof Error ? e.message : String(e);
    console.error("OCR failed:", ocrError);
  }

  const dateOrder: DateOrder = process.env.RECEIPT_DATE_ORDER === "MDY" ? "MDY" : "DMY";
  const parsed = rawText ? parseReceipt(rawText, { dateOrder }) : null;

  const { data: receipt, error: insertError } = await supabase
    .from("receipts")
    .insert({
      user_id: user.id,
      image_path: path,
      merchant: parsed?.merchant ?? null,
      purchase_date: parsed?.purchaseDate ?? null,
      total: parsed?.total ?? null,
      currency: parsed?.currency ?? null,
      group_name: group,
      raw_text: rawText,
    })
    .select()
    .single();

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
  return NextResponse.json({ receipt, ocrError });
}
