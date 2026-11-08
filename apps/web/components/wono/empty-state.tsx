import type { ComponentType, ReactNode } from "react";

export function EmptyState({ icon: Icon, title, children, action }: {
  icon: ComponentType<{ className?: string }>;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-background-tertiary-default">
        <Icon className="size-5 text-foreground-icon-secondary" aria-hidden />
      </span>
      <div className="flex max-w-96 flex-col gap-1">
        <p className="text-headline-semibold text-text-primary">{title}</p>
        {children ? <p className="text-body-regular text-text-secondary">{children}</p> : null}
      </div>
      {action}
    </div>
  );
}
