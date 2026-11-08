/** Everything on the page lives here. Edit freely; prices are USDC. */
export const PROFILE = {
  name: "Manish",
  handle: "TheSupermanish",
  bio: "full stack developer",
  avatar: "https://avatars.githubusercontent.com/u/81013430?v=4",
  /** Payments land here as USDC on Solana. No Wono account needed. */
  wallet: "5bPgahZJ3xcKTG6VZf4knWye2mLtiEWZE2uZYBWaci17",
  links: [
    { label: "X", href: "https://x.com/TheSupermanish", icon: "x" },
    { label: "GitHub", href: "https://github.com/TheSupermanish", icon: "github" },
  ],
} as const;

export type Product = {
  id: string;
  title: string;
  blurb: string;
  price: string;
  icon: "coffee" | "call" | "review" | "download";
  /** Tile colour. */
  tone: "sun" | "pink" | "mint" | "sky";
  /** What the buyer gets, shown only after Wono reports the invoice paid. */
  unlock: { kind: "note" | "dm" | "download"; text: string };
};


export const TIPS = ["1.00", "5.00", "10.00"] as const;
export const TIP_EMOJI: Record<(typeof TIPS)[number], string> = { "1.00": "☕", "5.00": "🧋", "10.00": "🍕" };

export const PRODUCTS: Product[] = [
  {
    id: "call",
    title: "30-min dev call",
    blurb: "Talk through your stack, a bug, or a payments flow.",
    price: "5.00",
    icon: "call",
    tone: "pink",
    unlock: { kind: "dm", text: "Send me a DM on X with your order reference and two times that work for you." },
  },
  {
    id: "review",
    title: "Code review",
    blurb: "I read your repo and send back what I'd change.",
    price: "3.00",
    icon: "review",
    tone: "mint",
    unlock: { kind: "dm", text: "Send me a DM on X with your order reference and the repo link." },
  },
  {
    id: "starter",
    title: "Solana payments starter",
    blurb: "A short guide: take any token, settle USDC on Solana, with Wono.",
    price: "1.00",
    icon: "download",
    tone: "sky",
    unlock: { kind: "download", text: "Your download is ready." },
  },
];

export const TIP: Product = {
  id: "tip",
  title: "Buy me a coffee",
  blurb: "Say thanks with any token.",
  price: "1.00",
  icon: "coffee",
  tone: "sun",
  unlock: { kind: "note", text: "Thank you, that genuinely made my day." },
};

export const DM_URL = `https://x.com/${PROFILE.handle}`;

/** Reference format: <productId>-<random>. The order page reads the product back from it. */
export function productFromReference(reference: string | null): Product | undefined {
  const id = reference?.split("-")[0];
  return id === "tip" ? TIP : PRODUCTS.find((product) => product.id === id);
}

/** The price this page charges for a product. Tips may be any of TIPS. */
export function priceFor(product: Product, requested?: string): string | undefined {
  if (product !== TIP) return product.price;
  return (TIPS as readonly string[]).includes(requested ?? "") ? requested : undefined;
}
