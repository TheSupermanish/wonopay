"use client";

import { useActionState } from "react";
import { AuthCard } from "@/components/application/auth/auth-card";
import { Logo } from "@/components/wono/logo";
import type { AuthState } from "./actions";

/** BoardUI AuthCard wired to Wono's server actions. Email + password only. */
export function AuthForm({ mode, action }: { mode: "signin" | "signup"; action: (state: AuthState, form: FormData) => Promise<AuthState> }) {
  const [state, formAction, pending] = useActionState(action, {});
  const signup = mode === "signup";
  return (
    <AuthCard
      mode={mode}
      logo={<Logo />}
      providers={[]}
      action={formAction}
      pending={pending}
      error={state.error}
      defaultEmail={state.email}
      switchHref={signup ? "/login" : "/signup"}
      showTerms={false}
      title={signup ? "Create a merchant account" : "Sign in to Wono"}
      description={signup ? "Customers pay from wallets on several chains. You receive USDC on Solana." : "Manage invoices that settle USDC on Solana."}
      nameField={{ name: "storeName", label: "Store name", placeholder: "Orbit Studio", autoComplete: "organization" }}
      passwordHint={signup ? "At least 12 characters." : undefined}
      copy={signup ? { cta: "Create merchant account" } : undefined}
    />
  );
}
