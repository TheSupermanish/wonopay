import { notFound } from "next/navigation";
import { DM_URL, PROFILE } from "@/lib/profile";
import { loadOrder, usdc, WONO_URL } from "@/lib/wono";
import { ProductIcon } from "../../icons";
import { Checkout } from "./checkout";

export const dynamic = "force-dynamic";

export default async function Order({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await loadOrder(id);
  if (!order) notFound();
  const { invoice, product, paid } = order;
  return (
    <div className="stack">
      <a href="/" className="back">← {PROFILE.name}</a>
      <section className="tile order" data-tone={product.tone}>
        <div className="tile-row">
          <span className="badge"><ProductIcon icon={product.icon} /></span>
          <div className="grow">
            <h2>{invoice.description ?? product.title}</h2>
            <p className="mono">{invoice.reference}</p>
          </div>
          <span className="amount">${usdc(invoice.amount, invoice.decimals)}</span>
        </div>

        {paid ? (
          <div className="unlock">
            <span className="paid">Paid · verified on Solana</span>
            <p>{product.unlock.text}</p>
            {product.unlock.kind === "download" ? (
              <a className="cta" href={`/download/${invoice.id}`}>Download the guide</a>
            ) : product.unlock.kind === "dm" ? (
              <a className="cta" href={DM_URL} target="_blank" rel="noreferrer">Message @{PROFILE.handle}</a>
            ) : null}
          </div>
        ) : (
          <>
            <p className="state">{invoice.state === "partial" ? "Partly paid. The rest is still due." : invoice.state === "open" ? "Waiting for payment." : "Payment in progress. This page updates when it lands."}</p>
            <Checkout invoiceId={invoice.id} wonoUrl={WONO_URL} label={`Pay $${usdc(invoice.remaining, invoice.decimals)}`} />
          </>
        )}
      </section>
    </div>
  );
}
