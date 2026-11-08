import { PROFILE, PRODUCTS, TIP, TIP_EMOJI, TIPS } from "@/lib/profile";
import { WONO_URL } from "@/lib/wono";
import { BuyButton } from "./buy-button";
import { ProductIcon, SocialIcon, Sparkle } from "./icons";

export default function Profile() {
  return (
    <div className="stack">
      <header className="profile">
        <Sparkle className="spark spark-a" />
        <Sparkle className="spark spark-b" />
        <Sparkle className="spark spark-c" />
        <div className="avatar-ring">
          <img className="avatar" src={PROFILE.avatar} alt="" width={96} height={96} />
          <span className="wave" aria-hidden>👋</span>
        </div>
        <h1>{PROFILE.name}</h1>
        <p className="handle">@{PROFILE.handle}</p>
        <p className="bio">{PROFILE.bio}</p>
        <nav className="socials" aria-label="Links">
          {PROFILE.links.map((link) => (
            <a key={link.href} href={link.href} target="_blank" rel="noreferrer" aria-label={link.label} className="social">
              <SocialIcon name={link.icon} />
            </a>
          ))}
        </nav>
      </header>

      <section className="tile" data-tone={TIP.tone}>
        <div className="tile-row">
          <span className="badge"><ProductIcon icon={TIP.icon} /></span>
          <div className="grow">
            <h2>{TIP.title}</h2>
            <p>{TIP.blurb}</p>
          </div>
        </div>
        <div className="chips">
          {TIPS.map((amount) => (
            <BuyButton key={amount} product={TIP.id} amount={amount} wonoUrl={WONO_URL} className="chip" label={`Tip $${Number(amount)}`}>
              <span className="chip-emoji" aria-hidden>{TIP_EMOJI[amount]}</span>${Number(amount)}
            </BuyButton>
          ))}
        </div>
      </section>

      {PRODUCTS.map((product) => (
        <div key={product.id} className="tile tile-row" data-tone={product.tone}>
          <span className="badge"><ProductIcon icon={product.icon} /></span>
          <div className="grow">
            <h2>{product.title}</h2>
            <p>{product.blurb}</p>
          </div>
          <BuyButton product={product.id} wonoUrl={WONO_URL} className="buy" label={`Buy ${product.title} for $${Number(product.price)}`}>${Number(product.price)}</BuyButton>
        </div>
      ))}

      <footer className="foot">
        Pay with any token on 8 chains · lands as USDC on Solana ·{" "}
        <a href="https://wonopay.vercel.app" target="_blank" rel="noreferrer">Wono</a>
      </footer>
    </div>
  );
}
