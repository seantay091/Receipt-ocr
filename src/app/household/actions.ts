"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type FormState = { error?: string; message?: string };

// Household data is shown on every page (header), so refresh the whole app.
const refresh = () => revalidatePath("/", "layout");

export async function renameHousehold(_prev: FormState, form: FormData): Promise<FormState> {
  const name = String(form.get("name") ?? "").trim();
  if (!name || name.length > 80) return { error: "Name must be 1–80 characters." };
  const supabase = await createClient();
  const { data: hh } = await supabase.from("household").select("id").single();
  const { error } = await supabase.from("household").update({ name }).eq("id", hh?.id ?? "");
  if (error) return { error: error.message };
  refresh();
  return { message: "Saved." };
}

export async function createInvite(): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_invite");
  if (error) return { error: error.message };
  refresh();
  return {};
}

export async function revokeInvite(form: FormData) {
  const id = String(form.get("id") ?? "");
  const supabase = await createClient();
  await supabase.from("household_invite").delete().eq("id", id);
  refresh();
}

export async function joinHousehold(_prev: FormState, form: FormData): Promise<FormState> {
  const code = String(form.get("code") ?? "").replace(/[\s-]/g, "").toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(code)) return { error: "Enter the 8-character code." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("join_household", { p_code: code });
  if (error) return { error: error.message };
  refresh();
  return { message: "You joined the household." };
}

export async function leaveHousehold(): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("leave_household");
  if (error) return { error: error.message };
  refresh();
  return { message: "You left the household and now have a new, empty one." };
}
