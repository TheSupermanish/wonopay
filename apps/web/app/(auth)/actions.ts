"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authenticate, createUser, endSession, startSession, throttle, validateEmail } from "@/lib/server/auth.ts";

export interface AuthState {
  error?: string;
  email?: string;
}

async function clientKey(email: string): Promise<string> {
  const forwarded = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  return `${forwarded}:${email}`;
}

export async function signUp(_state: AuthState, form: FormData): Promise<AuthState> {
  const email = validateEmail(String(form.get("email") ?? ""));
  const password = String(form.get("password") ?? "");
  const storeName = String(form.get("storeName") ?? "").trim();
  if (!email) return { error: "Enter a valid email address." };
  if (password.length < 12) return { error: "Use a password of at least 12 characters.", email };
  if (password.length > 256) return { error: "Password is too long.", email };
  if (!storeName || storeName.length > 80) return { error: "Enter your store name (up to 80 characters).", email };
  if (!throttle(`signup:${await clientKey(email)}`, 5)) return { error: "Too many attempts. Try again later.", email };
  let userId: string;
  try {
    userId = await createUser(email, password, storeName);
  } catch (error) {
    if (error instanceof Error && error.message === "EMAIL_TAKEN") return { error: "An account with this email already exists. Sign in instead.", email };
    throw error;
  }
  await startSession(userId);
  redirect("/dashboard/settings?welcome=1");
}

export async function signIn(_state: AuthState, form: FormData): Promise<AuthState> {
  const email = validateEmail(String(form.get("email") ?? ""));
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password.", email: email ?? "" };
  if (!throttle(`signin:${await clientKey(email)}`)) return { error: "Too many attempts. Try again in 15 minutes.", email };
  const userId = await authenticate(email, password);
  if (!userId) return { error: "Email or password is incorrect.", email };
  await startSession(userId);
  redirect("/dashboard");
}

export async function signOut(): Promise<void> {
  await endSession();
  redirect("/login");
}
