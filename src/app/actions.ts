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

  // Row-level security ensures users can only update their own rows.
  await supabase
    .from("receipts")
    .update({
      merchant: text(form, "merchant"),
      purchase_date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
      total: total !== null && Number.isFinite(total) ? total : null,
      currency: text(form, "currency", 3)?.toUpperCase() ?? null,
      group_name: text(form, "group_name", 60),
    })
    .eq("id", id);

  revalidatePath("/");
}

export async function deleteReceipt(form: FormData) {
  const supabase = await createClient();
  const id = text(form, "id");
  if (!id) return;

  const { data } = await supabase.from("receipts").delete().eq("id", id).select("image_path").single();
  if (data?.image_path) await supabase.storage.from(RECEIPTS_BUCKET).remove([data.image_path]);

  revalidatePath("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
