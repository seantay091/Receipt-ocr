import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type Household = {
  id: string;
  name: string;
  default_currency: string;
  tax_label: string;
  expiry_window_days: number;
  default_ocr_engine: "vision" | "claude";
  time_zone: string;
};

export type HouseholdMember = {
  user_id: string;
  email: string | null;
  role: "owner" | "member";
  joined_at: string;
  is_me: boolean;
};

// RLS only exposes the caller's own household, so there is at most one row.
// Every user gets a household at sign-up (trigger in migration 0002).
export async function getHousehold(supabase: SupabaseClient): Promise<Household> {
  const { data, error } = await supabase.from("household").select("*").single<Household>();
  if (error || !data) {
    throw new Error(
      `Could not load your household: ${error?.message ?? "not found"}. Did you run supabase/migrations/0002_households_items.sql?`,
    );
  }
  return data;
}
