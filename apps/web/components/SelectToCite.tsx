"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { citeSelectionAction } from "@/app/actions";

interface Pending {
  start: number;
  end: number;
  top: number;
  left: number;
}

/** Absolute offset of a DOM boundary point inside a segment that carries data-start. */
function offsetOf(node: Node, offset: number): number | null {
  if (node.nodeType !== Node.TEXT_NODE) return null;
  const seg = node.parentElement?.closest<HTMLElement>("[data-start]");
  if (!seg) return null;
  // Text before this node inside the same segment (anchors are empty spans).
  let before = 0;
  const walker = document.createTreeWalker(seg, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n && n !== node; n = walker.nextNode()) before += n.textContent?.length ?? 0;
  return Number(seg.dataset.start) + before + offset;
}

/**
 * Select text in the source to cite it, instead of copying the sentence.
 * Offsets come from the server-rendered segments, so the citation is exact.
 */
export function SelectToCite({
  productId,
  versionId,
  analysisId,
  children,
}: {
  productId: string;
  versionId: string;
  analysisId?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
    const onSelect = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount || !ref.current) return setPending(null);
      const range = sel.getRangeAt(0);
      if (!ref.current.contains(range.commonAncestorContainer)) return setPending(null);
      const start = offsetOf(range.startContainer, range.startOffset);
      const end = offsetOf(range.endContainer, range.endOffset);
      if (start === null || end === null || end <= start) return setPending(null);
      const rect = range.getBoundingClientRect();
      setError(null);
      setPending({ start, end, top: rect.bottom + window.scrollY + 6, left: Math.max(8, rect.left + window.scrollX) });
    };
    document.addEventListener("selectionchange", onSelect);
    return () => document.removeEventListener("selectionchange", onSelect);
  }, []);

  const cite = (thenAddClaim: boolean) => {
    if (!pending) return;
    startTransition(async () => {
      const r = await citeSelectionAction({ productId, versionId, start: pending.start, end: pending.end });
      if (r.error) return setError(r.error);
      window.getSelection()?.removeAllRanges();
      setPending(null);
      if (thenAddClaim && analysisId) router.push(`/p/${productId}/a/${analysisId}?step=claims&cite=${r.evidenceId}#add-claim`);
      else router.refresh();
    });
  };

  return (
    <div ref={ref} className="select-to-cite">
      {children}
      {pending ? (
        <div className="cite-popover" style={{ top: pending.top, left: pending.left }} role="toolbar" aria-label="引用所选文字">
          {analysisId ? (
            <button type="button" className="btn btn-primary" disabled={busy} onMouseDown={(e) => e.preventDefault()} onClick={() => cite(true)}>
              以此为依据添加条目
            </button>
          ) : null}
          <button type="button" className="btn btn-secondary" disabled={busy} onMouseDown={(e) => e.preventDefault()} onClick={() => cite(false)}>
            添加引用
          </button>
          {error ? <span className="error">{error}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
