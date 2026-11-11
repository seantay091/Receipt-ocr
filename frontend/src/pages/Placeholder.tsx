export default function Placeholder({ title, step }: { title: string; step?: number }) {
  return (
    <section>
      <h1>{title}</h1>
      <p className="muted">
        {step ? `Coming in build step ${step}.` : "This page does not exist."}
      </p>
    </section>
  );
}
