"use client";

import { useActionState } from "react";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Notice } from "@/components/wono/notice";
import { newInvoice, type FormState } from "../../actions";

export function NewInvoiceForm({ recipient }: { recipient: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(newInvoice, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <Input name="amount" label="Amount (USDC)" isRequired inputMode="decimal" placeholder="20.00" defaultValue={state.values?.amount} hint="Exact USDC your wallet must receive. Up to 6 decimals." />
      <Input name="description" label="Description" placeholder="Orbit Pro · monthly" defaultValue={state.values?.description} />
      <Input name="reference" label="Your reference" placeholder="order-1042" defaultValue={state.values?.reference} hint="Optional. Unique per store; useful to match your own orders." />
      <Input name="expiresInHours" label="Expires after (hours)" inputMode="numeric" placeholder="72" defaultValue={state.values?.expiresInHours} hint="Optional. New payments stop after expiry; in-flight transfers are still tracked." />
      <p className="text-body-regular text-text-secondary">Settles to <span className="font-mono text-body-2-regular" dir="ltr">{recipient}</span>. Later wallet changes do not affect this invoice.</p>
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create invoice"}</Button>
      </div>
    </form>
  );
}
