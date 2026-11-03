"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <section className="card">
      <h1>出错了</h1>
      <p>操作没有完成，数据未被部分修改。可以重试；如果反复出现，请在“设置与诊断”中查看运行状态。</p>
      <button type="button" className="btn btn-secondary" onClick={reset}>
        重试
      </button>
    </section>
  );
}
