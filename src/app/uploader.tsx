"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const MAX_SIDE = 2000;

// Downscale big phone photos before upload: faster, and well within OCR limits.
async function shrink(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    return blob ?? file;
  } catch {
    return file;
  }
}

export default function Uploader({ householdId }: { householdId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    const supabase = createClient();
    const problems: string[] = [];

    for (const [i, file] of [...files].entries()) {
      setBusy(`Reading receipt ${i + 1} of ${files.length}…`);
      const blob = await shrink(file);
      // Storage policies only allow writes inside the household's folder.
      const path = `${householdId}/${crypto.randomUUID()}.jpg`;

      const { error: upErr } = await supabase.storage
        .from("receipts")
        .upload(path, blob, { contentType: blob.type || "image/jpeg" });
      if (upErr) {
        problems.push(`${file.name}: ${upErr.message}`);
        continue;
      }

      const res = await fetch("/api/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, name: file.name }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) problems.push(`${file.name}: ${json.error ?? res.statusText}`);
      else if (json.ocrError) problems.push(`${file.name}: saved, but text could not be read (${json.ocrError}). Fill in the details by hand.`);
    }

    setBusy(null);
    if (problems.length) setError(problems.join("\n"));
    if (inputRef.current) inputRef.current.value = "";
    router.refresh();
  }

  return (
    <section className="card stack">
      <div className="row">
        <p className="grow muted small">Photos are shared with everyone in your household.</p>
        <button type="button" onClick={() => inputRef.current?.click()} disabled={!!busy}>
          {busy ?? "Upload receipt photos"}
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/*"
        multiple
        hidden
        onChange={(e) => handleFiles(e.target.files)}
      />
      {error && <p className="error pre">{error}</p>}
    </section>
  );
}
