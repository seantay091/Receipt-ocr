"use client";

import { useState } from "react";
import { deleteReceipt, updateReceipt } from "./actions";
import { formatMoney, type ReceiptWithFile } from "./types";

export default function ReceiptCard({ receipt, imageUrl }: { receipt: ReceiptWithFile; imageUrl: string | null }) {
  const [editing, setEditing] = useState(false);
  const r = receipt;

  return (
    <article className="receipt">
      {imageUrl ? (
        <a href={imageUrl} target="_blank" rel="noreferrer" className="thumb">
          {/* Signed Supabase URLs expire, so skip next/image optimisation. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt={`Receipt from ${r.store_name ?? "unknown store"}`} loading="lazy" />
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
          <label>Store<input name="store_name" defaultValue={r.store_name ?? ""} /></label>
          <label>Purchase date<input name="purchase_date" type="date" defaultValue={r.purchase_date ?? ""} /></label>
          <div className="row">
            <label className="grow">Total<input name="total" inputMode="decimal" defaultValue={r.total ?? ""} /></label>
            <label className="narrow-field">Currency<input name="currency" maxLength={3} defaultValue={r.currency} /></label>
          </div>
          <div className="row">
            <button type="submit">Save</button>
            <button type="button" className="secondary" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className="stack fields">
          <strong>{r.store_name ?? "Unknown store"}</strong>
          <span className="muted">{r.purchase_date ?? "No date"}</span>
          <span className="amount">{formatMoney(r.total, r.currency)}</span>
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
