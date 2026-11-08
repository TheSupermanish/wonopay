import { cx } from "@/utils/cx";

/**
 * Wono mark: a "w" drawn as two strokes that meet in the middle, the way several
 * payment routes converge into one USDC credit. Same 36px footprint as a sidebar item,
 * so it stays put when the rail collapses.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cx("flex size-9 shrink-0 items-center justify-center rounded-xl bg-foreground-icon-primary text-background-primary-default shadow-xs", className)}>
      <svg viewBox="0 0 32 32" className="size-6" fill="none">
        <path d="M6 10.5 10.75 21.5 16 13l5.25 8.5L26 10.5" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="16" cy="25.5" r="2.1" className="fill-accent-500" />
      </svg>
    </span>
  );
}

/** Mark plus wordmark. `subtitle` sits under the word (the store name in the dashboard). */
export function Logo({ subtitle, collapsed }: { subtitle?: string; collapsed?: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5" aria-label="Wono">
      <LogoMark />
      {collapsed ? null : (
        <span className="flex min-w-0 flex-col">
          <span className="text-headline-semibold text-text-primary">wono</span>
          {subtitle ? <span className="truncate text-caption-1-medium text-text-tertiary">{subtitle}</span> : null}
        </span>
      )}
    </span>
  );
}
