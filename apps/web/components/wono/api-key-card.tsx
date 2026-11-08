"use client";

import { useActionState } from "react";
import { RiKey2Line } from "@remixicon/react";
import { Chip } from "@/components/base/badges/chip";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Card } from "@/components/wono/card";
import { CopyField } from "@/components/wono/copy-field";
import { generateApiKey, type FormState } from "@/app/dashboard/actions";

export function ApiKeyCard({ hint }: { hint: string | null }) {
  const [state, action, pending] = useActionState<FormState>(generateApiKey, {});
  const active = Boolean(hint || state.apiKey);
  return (
    <form action={action}>
      <Card>
        <div className="flex items-center gap-3">
          <Chip color="orange" className="size-8 rounded-lg px-0" aria-hidden>
            <RiKey2Line className="size-4" />
          </Chip>
          <h2 className="min-w-0 flex-1 text-headline-semibold text-text-primary">API key</h2>
          <Chip variant="caption" color={active ? "lime" : "soft"}>{active ? "Active" : "None"}</Chip>
          <Button type="submit" size="small" variant="secondary" disabled={pending}>{active ? "Rotate" : "Create key"}</Button>
        </div>
        {state.apiKey ? (
          <div className="flex flex-col gap-1">
            <CopyField label="New key" value={state.apiKey} />
            <span className="text-caption-1-medium text-status-yellow-text">Copy it now. It won&apos;t be shown again.</span>
          </div>
        ) : hint ? (
          <Input aria-label="Active API key" isReadOnly value={`wono_sk_••••••••${hint}`} inputDir="ltr" />
        ) : null}
      </Card>
    </form>
  );
}
