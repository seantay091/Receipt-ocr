"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RECEIPTS_BUCKET } from "@/lib/supabase/env";

function text(form: FormData, key: string, max = 80): string | null {
  const v = form.get(key);
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

export async function updateReceipt(form: FormData) {
  const supabase = await createClient();
  const id = text(form, "id");
  if (!id) return;

  const totalRaw = text(form, "total");
  const total = totalRaw === null ? null : Number(totalRaw.replace(/,/g, ""));
  const date = text(form, "purchase_date");
  const currency = text(form, "currency", 3)?.toUpperCase();

  // Row-level security limits updates to the caller's household.
  await supabase
    .from("receipt")
    .update({
      store_name: text(form, "store_name", 200),
      purchase_date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
      total: total !== null && Number.isFinite(total) ? total : null,
      // currency is required; keep the current value unless a valid code was entered
      ...(currency && /^[A-Z]{3}$/.test(currency) ? { currency } : {}),
    })
    .eq("id", id);

  revalidatePath("/");
}

// Deleting a receipt also deletes its original file (row + storage object).
export async function deleteReceipt(form: FormData) {
  const supabase = await createClient();
  const id = text(form, "id");
  if (!id) return;

  const { data: receipt } = await supabase
    .from("receipt")
    .select("file_id, file(storage_path)")
    .eq("id", id)
    .single<{ file_id: string | null; file: { storage_path: string } | null }>();

  const { error } = await supabase.from("receipt").delete().eq("id", id);
  if (!error && receipt?.file_id) {
    await supabase.from("file").delete().eq("id", receipt.file_id);
    if (receipt.file) await supabase.storage.from(RECEIPTS_BUCKET).remove([receipt.file.storage_path]);
  }

  revalidatePath("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
