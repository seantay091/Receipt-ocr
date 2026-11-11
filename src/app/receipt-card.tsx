"use client";

import { useState } from "react";
import { deleteReceipt, updateReceipt } from "./actions";
import { formatMoney, type Receipt } from "./types";

export default function ReceiptCard({ receipt, imageUrl }: { receipt: Receipt; imageUrl: string | null }) {
  const [editing, setEditing] = useState(false);
  const r = receipt;

  return (
    <article className="receipt">
      {imageUrl ? (
        <a href={imageUrl} target="_blank" rel="noreferrer" className="thumb">
          {/* Signed Supabase URLs expire, so skip next/image optimisation. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt={`Receipt from ${r.merchant ?? "unknown merchant"}`} loading="lazy" />
        </a>
      ) : (
        <div className="thumb" />
      )}

      {editing ? (
        <form
          action={async (fd) => {
            await updateReceipt(fd);
            setEditing(false);
          }}
          className="stack fields"
        >
          <input type="hidden" name="id" value={r.id} />
          <label>Merchant<input name="merchant" defaultValue={r.merchant ?? ""} /></label>
          <label>Purchase date<input name="purchase_date" type="date" defaultValue={r.purchase_date ?? ""} /></label>
          <div className="row">
            <label className="grow">Total<input name="total" inputMode="decimal" defaultValue={r.total ?? ""} /></label>
            <label className="narrow-field">Currency<input name="currency" maxLength={3} defaultValue={r.currency ?? ""} /></label>
          </div>
          <label>Group<input name="group_name" list="group-options" defaultValue={r.group_name ?? ""} /></label>
          <div className="row">
            <button type="submit">Save</button>
            <button type="button" className="secondary" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className="stack fields">
          <strong>{r.merchant ?? "Unknown merchant"}</strong>
          <span className="muted">{r.purchase_date ?? "No date"}</span>
          <span className="amount">{formatMoney(r.total, r.currency)}</span>
          {r.group_name && <span className="tag">{r.group_name}</span>}
          <div className="row">
            <button type="button" className="secondary" onClick={() => setEditing(true)}>Edit</button>
            <form
              action={deleteReceipt}
              onSubmit={(e) => {
                if (!confirm("Delete this receipt?")) e.preventDefault();
              }}
            >
              <input type="hidden" name="id" value={r.id} />
              <button type="submit" className="danger">Delete</button>
            </form>
          </div>
          {r.raw_text && (
            <details>
              <summary className="muted">Scanned text</summary>
              <pre>{r.raw_text}</pre>
            </details>
          )}
        </div>
      )}
    </article>
  );
}
