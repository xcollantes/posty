// Page chrome shared by every screen: the dark hero, cards and the logo.

/**
 * A page: a dark hero with an eyebrow and title, then the content. The
 * content's first row overlaps the hero's bottom edge, so make it cards.
 */
export function Page({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <>
      <section className="hero text-white">
        <div className="mx-auto max-w-6xl px-4 pb-24 pt-8 sm:pt-10">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="mt-2">{title}</h1>
          {description && (
            <p className="mt-2 max-w-2xl text-chrome-muted [&_a]:text-white [&_a]:underline">{description}</p>
          )}
        </div>
      </section>
      <div className="relative mx-auto -mt-16 max-w-6xl px-4 pb-16">{children}</div>
    </>
  );
}

/** A rounded panel with an optional title row; `flush` drops the body padding. */
export function Card({
  title,
  hint,
  aside,
  flush,
  className = "",
  children,
}: {
  title?: string;
  hint?: React.ReactNode;
  aside?: React.ReactNode;
  flush?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`card ${className}`}>
      {title && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line px-5 py-4">
          <div>
            <h2>{title}</h2>
            {hint && <p className="hint mt-0.5">{hint}</p>}
          </div>
          {aside}
        </div>
      )}
      <div className={flush ? undefined : "p-5"}>{children}</div>
    </section>
  );
}

/** The Posty mark: a white P on the Instagram swatch gradient, as in app/icon.svg. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <defs>
        <linearGradient id="posty-logo" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#f8d948" />
          <stop offset=".25" stopColor="#ef8132" />
          <stop offset=".5" stopColor="#e9336a" />
          <stop offset=".75" stopColor="#c127bf" />
          <stop offset="1" stopColor="#6e3cf1" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#posty-logo)" />
      <path d="M10 25V7h7.5a5.5 5.5 0 0 1 0 11H14v7z" fill="none" stroke="#fff" strokeWidth="3" strokeLinejoin="round" />
    </svg>
  );
}
