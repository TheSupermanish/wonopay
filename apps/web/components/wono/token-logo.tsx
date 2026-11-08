import { CHAIN_ICONS, TOKEN_ICONS } from "@/lib/shared/icons";
import { cx } from "@/utils/cx";

/** Token logo with its chain as a corner badge. Logos ship in public/icons; unknown tokens get a monogram. */
export function TokenLogo({ symbol, blockchain, chainName, small, className }: { symbol: string; blockchain: string; chainName: string; small?: boolean; className?: string }) {
  const upper = symbol.toUpperCase();
  const size = small ? "size-5" : "size-8";
  return (
    <span className={cx("relative inline-flex shrink-0", size, className)}>
      {TOKEN_ICONS[upper] ? (
        <img src={`/icons/tokens/${TOKEN_ICONS[upper]}`} alt="" className={cx(size, "rounded-full bg-background-secondary-default object-cover")} />
      ) : (
        <span aria-hidden className={cx(size, "flex items-center justify-center rounded-full bg-background-tertiary-default text-caption-1-semibold text-text-secondary")}>
          {upper.slice(0, 2)}
        </span>
      )}
      {!small && CHAIN_ICONS.has(blockchain) ? (
        <img
          src={`/icons/chains/${blockchain}.svg`}
          alt={chainName}
          title={chainName}
          className="absolute -right-1 -bottom-1 size-4 rounded-full bg-background-primary-default ring-2 ring-background-primary-default"
        />
      ) : null}
    </span>
  );
}
