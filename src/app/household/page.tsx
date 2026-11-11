import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getHousehold, type HouseholdMember } from "@/lib/household";
import SiteHeader from "../site-header";
import { revokeInvite } from "./actions";
import { InviteButton, JoinForm, LeaveForm, RenameForm } from "./forms";

type Invite = { id: string; code: string; expires_at: string };

export default function HouseholdPage() {
  return (
    <main>
      <Suspense fallback={<p className="muted">Loading household…</p>}>
        <HouseholdDetails />
      </Suspense>
    </main>
  );
}

const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" });

async function HouseholdDetails() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const household = await getHousehold(supabase);
  const [{ data: memberRows }, { data: invites }] = await Promise.all([
    supabase.rpc("household_members"),
    supabase
      .from("household_invite")
      .select("id, code, expires_at")
      .is("used_by", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .returns<Invite[]>(),
  ]);
  const members = (memberRows ?? []) as HouseholdMember[];
  const shared = members.length > 1;

  return (
    <>
      <SiteHeader title="Household" email={user.email} householdName={household.name} />

      <section className="card stack">
        <RenameForm name={household.name} />
      </section>

      <section className="card stack">
        <h2>Members</h2>
        <ul className="plain">
          {members.map((m) => (
            <li key={m.user_id} className="row spread">
              <span>{m.email ?? "Unknown"}{m.is_me && <span className="muted"> (you)</span>}</span>
              <span className="muted small">{m.role === "owner" ? "Owner" : "Member"} · joined {fmt(m.joined_at)}</span>
            </li>
          ))}
        </ul>
        {shared && <LeaveForm />}
      </section>

      <section className="card stack">
        <h2>Invite someone</h2>
        <p className="muted small">
          Share a code with a family member. After they sign in, they enter it under “Join a household”.
          Each code works once and expires after 7 days.
        </p>
        {!!invites?.length && (
          <ul className="plain">
            {invites.map((inv) => (
              <li key={inv.id} className="row spread">
                <code className="invite-code">{inv.code}</code>
                <form action={revokeInvite} className="row">
                  <span className="muted small">expires {fmt(inv.expires_at)}</span>
                  <input type="hidden" name="id" value={inv.id} />
                  <button type="submit" className="secondary">Revoke</button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <InviteButton />
      </section>

      <section className="card stack">
        <h2>Join a household</h2>
        <p className="muted small">
          {shared
            ? "Joining another household moves you out of this one. Its receipts stay with the other members."
            : "Your own household must be empty (no receipts or contacts) before you can join another one."}
        </p>
        <JoinForm />
      </section>
    </>
  );
}
