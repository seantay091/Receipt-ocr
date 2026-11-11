import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RECEIPTS_BUCKET } from "@/lib/supabase/env";
import { signOut } from "./actions";
import Uploader from "./uploader";
import ReceiptCard from "./receipt-card";
import { formatMoney, type Receipt } from "./types";

const SORTS = {
  date_desc: { label: "Purchase date (newest)", column: "purchase_date", ascending: false },
  date_asc: { label: "Purchase date (oldest)", column: "purchase_date", ascending: true },
  uploaded: { label: "Recently uploaded", column: "created_at", ascending: false },
  total_desc: { label: "Total (highest)", column: "total", ascending: false },
} as const;
type SortKey = keyof typeof SORTS;

const VIEWS = { list: "Single list", group: "By my groups", month: "By month" } as const;
type ViewKey = keyof typeof VIEWS;

const UNGROUPED = "__none";

function pick<T extends string>(value: unknown, options: Record<T, unknown>, fallback: T): T {
  return typeof value === "string" && value in options ? (value as T) : fallback;
}

function monthLabel(date: string | null) {
  if (!date) return "No date";
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en", { month: "long", year: "numeric", timeZone: "UTC" });
}

export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <main>
      <Suspense fallback={<p className="muted">Loading receipts…</p>}>
        <Receipts searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Receipts({ searchParams }: Pick<PageProps<"/">, "searchParams">) {
  const params = await searchParams;
  const sort = pick<SortKey>(params.sort, SORTS, "date_desc");
  const view = pick<ViewKey>(params.view, VIEWS, "list");
  const groupFilter = typeof params.group === "string" ? params.group : "";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { column, ascending } = SORTS[sort];
  let query = supabase
    .from("receipts")
    .select("*")
    .order(column, { ascending, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (groupFilter === UNGROUPED) query = query.is("group_name", null);
  else if (groupFilter) query = query.eq("group_name", groupFilter);

  const [{ data: receipts, error }, { data: groupRows }] = await Promise.all([
    query.returns<Receipt[]>(),
    supabase.from("receipts").select("group_name").not("group_name", "is", null),
  ]);

  const groups = [...new Set((groupRows ?? []).map((g) => g.group_name as string))].sort((a, b) => a.localeCompare(b));

  // Private bucket → short-lived signed URLs for thumbnails.
  const urlByPath = new Map<string, string>();
  if (receipts?.length) {
    const { data: signed } = await supabase.storage
      .from(RECEIPTS_BUCKET)
      .createSignedUrls(receipts.map((r) => r.image_path), 60 * 60);
    signed?.forEach((s) => s.path && s.signedUrl && urlByPath.set(s.path, s.signedUrl));
  }

  // Bucket receipts into sections for the chosen view (order within each is preserved).
  const sections = new Map<string, Receipt[]>();
  for (const r of receipts ?? []) {
    const key = view === "group" ? (r.group_name ?? "Ungrouped") : view === "month" ? monthLabel(r.purchase_date) : "";
    sections.set(key, [...(sections.get(key) ?? []), r]);
  }

  return (
    <>
      <header className="row spread">
        <h1>My receipts</h1>
        <form action={signOut} className="row">
          <span className="muted small">{user.email}</span>
          <button type="submit" className="secondary">Sign out</button>
        </form>
      </header>

      <Uploader userId={user.id} groups={groups} />

      <form className="row filters" method="get">
        <label>
          Sort by
          <select name="sort" defaultValue={sort}>
            {Object.entries(SORTS).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </label>
        <label>
          Show
          <select name="view" defaultValue={view}>
            {Object.entries(VIEWS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Group
          <select name="group" defaultValue={groupFilter}>
            <option value="">All groups</option>
            <option value={UNGROUPED}>Ungrouped</option>
            {groups.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="secondary">Apply</button>
        {(params.sort || params.view || params.group) && <Link href="/" className="small">Reset</Link>}
      </form>

      {error && <p className="error">Could not load receipts: {error.message}. Did you run supabase/migrations/0001_init.sql?</p>}
      {!error && receipts?.length === 0 && <p className="muted">No receipts yet. Upload a photo to get started.</p>}

      {[...sections.entries()].map(([title, items]) => {
        const sum = items.reduce((acc, r) => acc + (r.total === null ? 0 : Number(r.total)), 0);
        const currencies = new Set(items.map((r) => r.currency).filter(Boolean));
        return (
          <section key={title || "all"} className="stack">
            {title && (
              <h2 className="row spread">
                <span>{title}</span>
                <span className="muted small">
                  {items.length} receipt{items.length === 1 ? "" : "s"}
                  {currencies.size <= 1 && ` · ${formatMoney(sum, [...currencies][0] ?? null)}`}
                </span>
              </h2>
            )}
            <div className="grid">
              {items.map((r) => (
                <ReceiptCard key={r.id} receipt={r} imageUrl={urlByPath.get(r.image_path) ?? null} />
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}
