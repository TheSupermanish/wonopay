import { redirect } from "next/navigation";
import { currentMerchant } from "@/lib/server/auth.ts";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await currentMerchant()) redirect("/dashboard");
  return <main className="flex min-h-dvh items-center justify-center px-4 py-12">{children}</main>;
}
