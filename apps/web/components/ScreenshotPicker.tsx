"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export const MAX_IMAGES = 20;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ACCEPT = ["image/png", "image/jpeg", "image/webp", "image/gif"];

function fmtSize(n: number) {
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`;
}

/**
 * Collects chat screenshots by paste (anywhere on the page), drag-and-drop or
 * file picker. The server re-checks type from the bytes; this only gives early feedback.
 */
export function ScreenshotPicker({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  const [message, setMessage] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const filesRef = useRef(files);
  filesRef.current = files;

  const add = (incoming: File[]) => {
    const images = incoming.filter((f) => ACCEPT.includes(f.type));
    const skipped = incoming.length - images.length;
    const tooBig = images.filter((f) => f.size > MAX_IMAGE_BYTES);
    const ok = images.filter((f) => f.size <= MAX_IMAGE_BYTES);
    const room = MAX_IMAGES - filesRef.current.length;
    const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, "");
    const named = ok.slice(0, room).map((f, i) =>
      // Pasted images all arrive as "image.png"; give them distinguishable names.
      f.name === "image.png" || !f.name ? new File([f], `screenshot-${stamp}-${filesRef.current.length + i + 1}.${f.type.split("/")[1]}`, { type: f.type }) : f,
    );
    const notes = [
      skipped ? `Ignored ${skipped === 1 ? "1 file that is" : `${skipped} files that are`} not PNG, JPEG, WebP or GIF` : "",
      tooBig.length ? `Ignored ${tooBig.length === 1 ? "1 image" : `${tooBig.length} images`} over 10 MB` : "",
      ok.length > room ? `At most ${MAX_IMAGES} images; the rest were ignored` : "",
    ].filter(Boolean);
    setMessage(notes.length ? notes.join("; ") : null);
    if (named.length) onChange([...filesRef.current, ...named]);
  };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const images = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (!images.length) return;
      // Spreadsheets also put a rendered image on the clipboard; text pasted into a field stays text.
      const inField = (e.target as HTMLElement | null)?.closest?.("textarea, input, [contenteditable]");
      if (inField && e.clipboardData?.types.includes("text/plain")) return;
      e.preventDefault();
      add(images);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const previews = useMemo(() => files.map((f) => ({ file: f, url: URL.createObjectURL(f) })), [files]);
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews]);

  return (
    <div>
      <div
        className={dragging ? "dropzone dropzone-active" : "dropzone"}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          add([...e.dataTransfer.files]);
        }}
      >
        <p>
          <strong>Paste screenshots with ⌘V / Ctrl+V</strong>, drag them here, or
          <label className="linklike file-link">
            choose images
            <input
              type="file"
              accept={ACCEPT.join(",")}
              multiple
              className="visually-hidden"
              onChange={(e) => {
                add([...(e.target.files ?? [])]);
                e.target.value = "";
              }}
            />
          </label>
        </p>
        <p className="help">Screenshots are saved as sources exactly as they are. With a model configured, they can be read and split into requests automatically; otherwise you can transcribe them by hand after saving.</p>
      </div>
      {message ? <p className="warn">{message}</p> : null}
      {previews.length ? (
        <ul className="thumbs" aria-label="Added screenshots">
          {previews.map(({ file, url }, i) => (
            <li key={url}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`Screenshot ${i + 1}: ${file.name}`} />
              <span className="thumb-name">{file.name}</span>
              <span className="muted">{fmtSize(file.size)}</span>
              <button type="button" className="linklike danger" onClick={() => onChange(files.filter((f) => f !== file))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
