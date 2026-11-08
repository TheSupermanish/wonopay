"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { currentMerchant, rotateApiKey } from "@/lib/server/auth.ts";
import { createInvoice, invoiceForMerchant, updateLogo, updateSettings, UserError } from "@/lib/server/invoices.ts";
import { reconcileInvoice } from "@/lib/server/payments.ts";

export interface FormState {
  error?: string;
  saved?: boolean;
  apiKey?: string;
  values?: Record<string, string>;
}

async function requireMerchant() {
  const merchant = await currentMerchant();
  if (!merchant) redirect("/login");
  return merchant;
}

export async function saveSettings(_state: FormState, form: FormData): Promise<FormState> {
  const merchant = await requireMerchant();
  const values = {
    storeName: String(form.get("storeName") ?? ""),
    settlementAddress: String(form.get("settlementAddress") ?? ""),
    origins: String(form.get("origins") ?? ""),
  };
  try {
    await updateSettings(merchant, values);
  } catch (error) {
    if (error instanceof UserError) return { error: error.message, values };
    throw error;
  }
  revalidatePath("/dashboard", "layout");
  return { saved: true, values };
}

export async function saveLogo(_state: FormState, form: FormData): Promise<FormState> {
  const merchant = await requireMerchant();
  const logo = String(form.get("logo") ?? "");
  try {
    await updateLogo(merchant.id, logo || null);
  } catch (error) {
    if (error instanceof UserError) return { error: error.message };
    throw error;
  }
  revalidatePath("/dashboard", "layout");
  return { saved: true };
}

export async function generateApiKey(_state: FormState): Promise<FormState> {
  const merchant = await requireMerchant();
  return { apiKey: await rotateApiKey(merchant.id) };
}

export async function newInvoice(_state: FormState, form: FormData): Promise<FormState> {
  const merchant = await requireMerchant();
  const values = {
    amount: String(form.get("amount") ?? ""),
    description: String(form.get("description") ?? ""),
    reference: String(form.get("reference") ?? ""),
    expiresInHours: String(form.get("expiresInHours") ?? ""),
  };
  let id: string;
  try {
    const hours = values.expiresInHours.trim() ? Number(values.expiresInHours) : undefined;
    const invoice = await createInvoice(merchant, {
      amount: values.amount,
      description: values.description,
      reference: values.reference,
      ...(hours !== undefined ? { expiresInHours: hours } : {}),
    });
    id = invoice.id;
  } catch (error) {
    if (error instanceof UserError) return { error: error.message, values };
    throw error;
  }
  redirect(`/dashboard/invoices/${id}`);
}

export async function refreshInvoice(invoiceId: string): Promise<void> {
  const merchant = await requireMerchant();
  if (!(await invoiceForMerchant(merchant.id, invoiceId))) return;
  await reconcileInvoice(invoiceId);
  revalidatePath(`/dashboard/invoices/${invoiceId}`);
}
