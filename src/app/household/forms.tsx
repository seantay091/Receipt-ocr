"use client";

import { useActionState } from "react";
import { createInvite, joinHousehold, leaveHousehold, renameHousehold, type FormState } from "./actions";

function Status({ state }: { state: FormState }) {
  if (state.error) return <p className="error" role="alert">{state.error}</p>;
  if (state.message) return <p className="muted small" aria-live="polite">{state.message}</p>;
  return null;
}

export function RenameForm({ name }: { name: string }) {
  const [state, action, pending] = useActionState(renameHousehold, {});
  return (
    <form action={action} className="stack">
      <div className="row">
        <label className="grow">
          Household name
          <input name="name" defaultValue={name} maxLength={80} required />
        </label>
        <button type="submit" className="secondary" disabled={pending}>Save</button>
      </div>
      <Status state={state} />
    </form>
  );
}

export function InviteButton() {
  const [state, action, pending] = useActionState(createInvite, {});
  return (
    <form action={action} className="stack">
      <button type="submit" disabled={pending}>{pending ? "Creating…" : "Create invite code"}</button>
      <Status state={state} />
    </form>
  );
}

export function JoinForm() {
  const [state, action, pending] = useActionState(joinHousehold, {});
  return (
    <form action={action} className="stack">
      <div className="row">
        <label className="grow">
          Invite code
          <input name="code" placeholder="e.g. K7QM2XPA" autoComplete="off" autoCapitalize="characters" required />
        </label>
        <button type="submit" disabled={pending}>{pending ? "Joining…" : "Join"}</button>
      </div>
      <Status state={state} />
    </form>
  );
}

export function LeaveForm() {
  const [state, action, pending] = useActionState(leaveHousehold, {});
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("Leave this household? You will lose access to its receipts.")) e.preventDefault();
      }}
      className="stack"
    >
      <button type="submit" className="danger" disabled={pending}>Leave household</button>
      <Status state={state} />
    </form>
  );
}
