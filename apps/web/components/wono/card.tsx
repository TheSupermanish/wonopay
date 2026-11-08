import type { ReactNode } from "react";
import { cx } from "@/utils/cx";

/** The one card: BoardUI panel shape (rounded-3xl, button border, primary surface). */
export function Card({ title, description, actions, children, className }: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("flex min-w-0 flex-col gap-4 rounded-3xl border border-border-button-default bg-background-primary-default p-5 shadow-xs", className)}>
      {title || actions ? (
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            {title ? <h2 className="text-headline-semibold text-text-primary">{title}</h2> : null}
            {description ? <p className="text-body-regular text-text-secondary">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}
