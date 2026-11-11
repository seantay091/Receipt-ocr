import { useConfig } from "../ConfigContext";

export default function Dashboard() {
  const { config } = useConfig();
  return (
    <section>
      <h1>Dashboard</h1>
      <p className="muted">Warranty expiry cards and recent receipts arrive in build step 4.</p>
      {config && (
        <dl className="kv">
          <dt>Default OCR engine</dt>
          <dd>{config.default_engine === "opensource" ? "Open-source (Tesseract)" : "Claude"}</dd>
          <dt>Claude</dt>
          <dd>{config.claude_available ? "Available" : "Not configured (no API key in .env)"}</dd>
          <dt>Currency / tax</dt>
          <dd>
            {config.currency} / {config.tax_label}
          </dd>
          <dt>Expiry alert window</dt>
          <dd>{config.expiry_window_days} days</dd>
        </dl>
      )}
    </section>
  );
}
