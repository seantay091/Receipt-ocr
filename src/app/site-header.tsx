import Link from "next/link";
import { signOut } from "./actions";

export default function SiteHeader({ title, email, householdName }: { title: string; email?: string; householdName: string }) {
  return (
    <header className="stack">
      <nav className="row spread">
        <div className="row nav-links">
          <Link href="/">Receipts</Link>
          <Link href="/household">Household · {householdName}</Link>
        </div>
        <form action={signOut} className="row">
          {email && <span className="muted small">{email}</span>}
          <button type="submit" className="secondary">Sign out</button>
        </form>
      </nav>
      <h1>{title}</h1>
    </header>
  );
}
