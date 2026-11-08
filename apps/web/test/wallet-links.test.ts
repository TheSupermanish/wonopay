import { test } from "node:test";
import assert from "node:assert/strict";
import { isPublicUrl, walletAppLinks } from "../lib/shared/wallet-links.ts";

test("wallet app links carry the encoded checkout URL", () => {
  const links = Object.fromEntries(walletAppLinks("https://wono.fi/pay/inv_abc").map((link) => [link.key, link.href]));
  assert.equal(links.phantom, "https://phantom.app/ul/browse/https%3A%2F%2Fwono.fi%2Fpay%2Finv_abc?ref=https%3A%2F%2Fwono.fi");
  assert.equal(links.solflare, "https://solflare.com/ul/v1/browse/https%3A%2F%2Fwono.fi%2Fpay%2Finv_abc?ref=https%3A%2F%2Fwono.fi");
  assert.equal(links.metamask, "https://metamask.app.link/dapp/wono.fi/pay/inv_abc");
  assert.equal(links.coinbase, "https://go.cb-w.com/dapp?cb_url=https%3A%2F%2Fwono.fi%2Fpay%2Finv_abc");
});

test("only public https pages can be opened in a wallet app", () => {
  assert.equal(isPublicUrl("https://wono.fi/pay/inv_abc"), true);
  for (const url of ["http://wono.fi/pay/x", "https://localhost:3080/pay/x", "http://127.0.0.1:3080/pay/x", "https://192.168.1.4/pay/x", "https://10.0.0.2/pay/x", "https://172.20.0.1/pay/x", "https://[::1]/pay/x", "not a url"]) {
    assert.equal(isPublicUrl(url), false, url);
  }
});
