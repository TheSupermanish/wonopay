"use client";

import { useState } from "react";
import { RiCheckLine, RiFileCopyLine } from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { InputBase, TextField } from "@/components/base/input/input";
import { Label } from "@/components/base/input/label";

/** Read-only value with a copy button. Same control height as every other field. */
export function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <TextField value={value} isReadOnly aria-label={label} className="gap-1">
        <Label>{label}</Label>
        <div className="flex w-full items-center gap-2">
          <InputBase className="font-mono" fieldClassName="min-w-0 flex-1" />
          <Button
            variant="secondary"
            leadingIcon={copied ? RiCheckLine : RiFileCopyLine}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(value);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </TextField>
    </div>
  );
}

export function CopyBlock({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-body-medium text-text-secondary">{label}</span>
        <Button
          variant="secondary"
          size="small"
          leadingIcon={copied ? RiCheckLine : RiFileCopyLine}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="max-h-80 overflow-auto rounded-2lg bg-background-secondary-default p-3 font-mono text-body-2-regular text-text-primary" dir="ltr">
        <code>{value}</code>
      </pre>
    </div>
  );
}
