import type { ReactNode } from "react";

/** Label/value rows. Values wrap; long identifiers break instead of overflowing. */
export function Details({ rows }: { rows: { label: ReactNode; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
      {rows.map((row, index) => (
        <div key={index} className="contents">
          <dt className="text-body-regular text-text-tertiary">{row.label}</dt>
          <dd className="min-w-0 break-words text-body-medium text-text-primary">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className="break-all font-mono text-body-2-regular" dir="ltr">{children}</span>;
}
