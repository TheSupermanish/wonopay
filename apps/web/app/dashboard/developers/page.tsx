import type { Metadata } from "next";
import { ApiKeyCard } from "@/components/wono/api-key-card";
import { Card } from "@/components/wono/card";
import { CopyBlock, CopyField } from "@/components/wono/copy-field";
import { PageHeader } from "@/components/wono/page-header";
import { currentMerchant } from "@/lib/server/auth.ts";
import { publicOrigin } from "@/lib/server/origin.ts";
import { sdkSnippets } from "@/lib/shared/snippets";

export const metadata: Metadata = { title: "Developers" };

export default async function DevelopersPage() {
  const merchant = (await currentMerchant())!;
  const origin = await publicOrigin();
  const snippets = sdkSnippets(origin);
  return (
    <>
      <PageHeader title="Developers" description="Take payments from your own store with the SDK." />
      <div className="grid items-start gap-6 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 xl:col-span-2">
          <Card title="1. Install">
            <CopyField label="Terminal" value={snippets.install} />
          </Card>
          <Card title="2. Create a payment on your server">
            <CopyBlock label="server.ts" value={snippets.server} />
          </Card>
          <Card title="3. Open checkout in the browser">
            <CopyBlock label="Checkout.tsx" value={snippets.client} />
          </Card>
          <Card title="4. Fulfil when paid">
            <CopyBlock label="server.ts" value={snippets.confirm} />
          </Card>
        </div>
        <div className="flex min-w-0 flex-col gap-6 xl:sticky xl:top-8">
          <ApiKeyCard hint={merchant.apiKeyHint} />
          <Card title="Wono URL">
            <CopyField label="baseUrl" value={origin} />
          </Card>
        </div>
      </div>
    </>
  );
}
