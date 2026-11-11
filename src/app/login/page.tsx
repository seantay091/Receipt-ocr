import { Suspense } from "react";
import LoginForm from "./login-form";

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="narrow">
      <h1>Receipt OCR</h1>
      <p className="muted">Snap a receipt, and we&apos;ll read the store, date and total for you.</p>
      <Suspense>
        <LinkError searchParams={searchParams} />
      </Suspense>
      <LoginForm />
    </main>
  );
}

async function LinkError({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const { error } = await searchParams;
  if (error !== "link") return null;
  return <p className="error">That sign-in link is invalid or expired. Request a new one.</p>;
}
