import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/wono/dashboard-shell";
import { currentMerchant } from "@/lib/server/auth.ts";
import { signOut } from "../(auth)/actions";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const merchant = await currentMerchant();
  if (!merchant) redirect("/login");
  return (
    <DashboardShell storeName={merchant.storeName} email={merchant.email} signOut={signOut}>
      {children}
    </DashboardShell>
  );
}
