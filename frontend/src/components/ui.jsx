import { useState } from "react";

export function PageHead({ eyebrow, title, lede, children }) {
  return (
    <header className="page-head">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h1 className="title">{title}</h1>
      {lede && <p className="lede">{lede}</p>}
      {children}
    </header>
  );
}

export function Section({ title, note, right, children, className = "" }) {
  return (
    <section className={`sec ${className}`}>
      {title && (
        <div className="flex items-end justify-between gap-4 border-b border-[var(--line)] pb-[10px]">
          <h2 className="sec-title !border-0 !p-0">{title}</h2>
          {right}
        </div>
      )}
      {note && <p className="sec-note">{note}</p>}
      {children}
    </section>
  );
}

export function Tally({ items }) {
  return (
    <div className="tally" style={{ "--cols": items.length }}>
      {items.map((it) => (
        <div key={it.label} className={it.tone || ""}>
          <div className="n">{it.value ?? "—"}</div>
          <div className="k">{it.label}</div>
        </div>
      ))}
    </div>
  );
}

export const Chip = ({ tone = "muted", dot, children }) => (
  <span className={`chip ${tone}`}>
    {dot && <span className="dot" />}
    {children}
  </span>
);

export function Callout({ tone = "", title, children, className = "" }) {
  return (
    <div className={`callout ${tone} ${className}`}>
      <p>
        {title && <strong>{title} </strong>}
        {children}
      </p>
    </div>
  );
}

export const Spinner = () => <span className="spinner" aria-hidden="true" />;

export function Button({ variant = "primary", size, loading, children, className = "", ...rest }) {
  return (
    <button className={`btn btn-${variant} ${size ? `btn-${size}` : ""} ${className}`} disabled={loading || rest.disabled} {...rest}>
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function CopyButton({ value, label = "Copy" }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(String(value));
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } catch {}
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}

/** A long hash with a copy action. */
export function Hash({ value, display, copy = true }) {
  return (
    <span className="inline-flex items-start gap-1 max-w-full">
      <span className="hash">{display ?? String(value)}</span>
      {copy && <CopyButton value={value} />}
    </span>
  );
}

export function Field({ label, hint, children, htmlFor }) {
  return (
    <div>
      {label && <label className="label" htmlFor={htmlFor}>{label}</label>}
      {children}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

export const Empty = ({ children }) => <div className="empty">{children}</div>;

export function KV({ rows }) {
  return (
    <dl className="kv">
      {rows.filter(Boolean).map(([k, v]) => (
        <div key={k} className="contents">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
