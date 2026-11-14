"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <section className="card">
      <h1>Something went wrong</h1>
      <p>The action did not complete, and no data was partly changed. Try again; if it keeps happening, check the status under Settings.</p>
      <button type="button" className="btn btn-secondary" onClick={reset}>
        Try again
      </button>
    </section>
  );
}
