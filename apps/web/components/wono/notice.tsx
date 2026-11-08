import type { ComponentType, ReactNode } from "react";
import { RiAlertLine, RiErrorWarningLine, RiInformationLine } from "@remixicon/react";
import { cx } from "@/utils/cx";

const TONES = {
  info: { icon: RiInformationLine, className: "bg-background-secondary-default text-text-secondary" },
  warning: { icon: RiAlertLine, className: "bg-status-yellow-background text-status-yellow-text" },
  error: { icon: RiErrorWarningLine, className: "bg-status-rose-background text-status-rose-text" },
} satisfies Record<string, { icon: ComponentType<{ className?: string }>; className: string }>;

/** Inline callout. Errors use role="alert" so assistive tech announces them. */
export function Notice({ tone = "info", title, children }: { tone?: keyof typeof TONES; title?: ReactNode; children?: ReactNode }) {
  const { icon: Icon, className } = TONES[tone];
  return (
    <div role={tone === "error" ? "alert" : undefined} className={cx("flex gap-2 rounded-2lg p-3", className)}>
      <Icon className="size-5 shrink-0" aria-hidden />
      <div className="flex min-w-0 flex-col gap-1 text-body-regular">
        {title ? <strong className="text-body-semibold">{title}</strong> : null}
        {children}
      </div>
    </div>
  );
}
