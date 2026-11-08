"use client";

import {
  startTransition,
  useActionState,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  RiArrowLeftRightLine,
  RiCodeSSlashLine,
  RiDeleteBinLine,
  RiImageAddLine,
  RiKey2Line,
  RiStore2Line,
  RiWallet3Line,
} from "@remixicon/react";
import { Chip, type ChipColor } from "@/components/base/badges/chip";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Card } from "@/components/wono/card";
import { CopyField } from "@/components/wono/copy-field";
import { Notice } from "@/components/wono/notice";
import { Divider } from "@/components/base/divider/divider";
import { TokenLogo } from "@/components/wono/token-logo";
import { shortAddress } from "@/lib/shared/format";
import { cx } from "@/utils/cx";
import {
  generateApiKey,
  saveLogo,
  saveSettings,
  type FormState,
} from "../actions";
import {
  PaymasterCard,
  type PaymasterView,
} from "@/components/wono/paymaster-card";

const CHAINS = [
  { id: "sol", name: "Solana" },
  { id: "base", name: "Base" },
  { id: "eth", name: "Ethereum" },
  { id: "arb", name: "Arbitrum" },
  { id: "op", name: "Optimism" },
  { id: "pol", name: "Polygon" },
  { id: "bsc", name: "BNB Chain" },
  { id: "avax", name: "Avalanche" },
];

const splitOrigins = (value: string) =>
  value
    .split(/[\s,]+/)
    .map((origin) => origin.trim())
    .filter(Boolean);

/** Card heading with a tinted icon; the tint reuses Chip's colour pairs. */
function Heading({
  icon: Icon,
  color,
  title,
  status,
}: {
  icon: ComponentType<{ className?: string }>;
  color: ChipColor;
  title: string;
  status?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <Chip color={color} className="size-8 rounded-lg px-0" aria-hidden>
        <Icon className="size-4" />
      </Chip>
      <h2 className="min-w-0 flex-1 text-headline-semibold text-text-primary">
        {title}
      </h2>
      {status}
    </div>
  );
}

function walletStatus(
  address: string,
  saved: string,
  usdcReady: boolean | null,
): { color: ChipColor; label: string } {
  if (!address) return { color: "yellow", label: "Not set" };
  if (address !== saved) return { color: "soft", label: "Unsaved" };
  if (usdcReady === true) return { color: "lime", label: "USDC ready" };
  if (usdcReady === false) return { color: "yellow", label: "No USDC account" };
  return { color: "soft", label: "Saved" };
}

/** One step of the money path: a 32px leading visual, joined to the next step by a hairline. */
function FlowStep({
  visual,
  title,
  detail,
  last,
}: {
  visual: ReactNode;
  title: ReactNode;
  detail: ReactNode;
  last?: boolean;
}) {
  return (
    <li className={cx("relative flex gap-3", !last && "pb-5")}>
      {last ? null : (
        <span
          aria-hidden
          className="absolute start-4 top-9 bottom-1 w-px bg-separator-border"
        />
      )}
      <span className="flex size-8 shrink-0 items-center justify-center">
        {visual}
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="truncate text-body-medium text-text-primary">
          {title}
        </span>
        {detail}
      </div>
    </li>
  );
}

function CheckoutPreview({
  storeName,
  address,
  logo,
}: {
  storeName: string;
  address: string;
  logo: string | null;
}) {
  const name = storeName.trim() || "Your store";
  return (
    <Card
      title="Customer view"
      actions={
        <Chip variant="caption" color="blue">
          Live
        </Chip>
      }
      className="xl:sticky xl:top-8"
    >
      <ol className="flex flex-col">
        <FlowStep
          visual={<StoreAvatar name={name} logo={logo} size="sm" />}
          title={name}
          detail={
            <span className="text-caption-1-medium text-text-tertiary">
              Checkout
            </span>
          }
        />
        <FlowStep
          visual={
            <Chip
              color="purple"
              className="size-8 rounded-full px-0"
              aria-hidden
            >
              <RiArrowLeftRightLine className="size-4" />
            </Chip>
          }
          title="Any token, 8 chains"
          detail={
            <span className="flex -space-x-1">
              {CHAINS.map((chain) => (
                <img
                  key={chain.id}
                  src={`/icons/chains/${chain.id}.svg`}
                  alt={chain.name}
                  title={chain.name}
                  className="size-5 rounded-full bg-background-primary-default ring-2 ring-background-primary-default"
                />
              ))}
            </span>
          }
        />
        <FlowStep
          last
          visual={
            <TokenLogo symbol="USDC" blockchain="sol" chainName="Solana" />
          }
          title="USDC on Solana"
          detail={
            <span
              className={cx(
                "truncate text-caption-1-medium text-text-tertiary",
                address && "font-mono",
              )}
            >
              {address ? shortAddress(address) : "No payout wallet"}
            </span>
          }
        />
      </ol>
    </Card>
  );
}

/** Store logo, or its initial when there is none. */
function StoreAvatar({
  name,
  logo,
  size,
}: {
  name: string;
  logo: string | null;
  size: "sm" | "lg";
}) {
  const box = size === "lg" ? "size-14" : "size-8";
  if (logo)
    return (
      <img
        src={logo}
        alt=""
        className={cx(
          box,
          "shrink-0 rounded-full bg-background-secondary-default object-cover",
        )}
      />
    );
  return (
    <span
      aria-hidden
      className={cx(
        box,
        "flex shrink-0 items-center justify-center rounded-full bg-button-ghost-background text-button-ghost-foreground",
        size === "lg" ? "text-title-3-semibold" : "text-body-medium",
      )}
    >
      {(name.trim() || "?").slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Downscale to a 256px square WebP in the browser, so the stored logo stays small. */
async function toLogoDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  canvas
    .getContext("2d")!
    .drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      256,
      256,
    );
  return canvas.toDataURL("image/webp", 0.9);
}

function LogoPicker({ name, logo }: { name: string; logo: string | null }) {
  const [state, dispatch, pending] = useActionState<FormState, FormData>(
    saveLogo,
    {},
  );
  const [readError, setReadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const submit = (value: string) => {
    const form = new FormData();
    form.set("logo", value);
    startTransition(() => dispatch(form));
  };
  return (
    <div className="flex items-center gap-4">
      <StoreAvatar name={name} logo={logo} size="lg" />
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              setReadError(null);
              try {
                submit(await toLogoDataUrl(file));
              } catch {
                setReadError("Could not read that image.");
              }
            }}
          />
          <Button
            size="small"
            variant="secondary"
            leadingIcon={RiImageAddLine}
            disabled={pending}
            onClick={() => fileInput.current?.click()}
          >
            {logo ? "Replace logo" : "Upload logo"}
          </Button>
          {logo ? (
            <Button
              size="small"
              variant="ghost"
              leadingIcon={RiDeleteBinLine}
              disabled={pending}
              onClick={() => submit("")}
            >
              Remove
            </Button>
          ) : null}
        </div>
        {state.error || readError ? (
          <span className="text-caption-1-medium text-text-error-primary">
            {state.error ?? readError}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function SettingsView({
  storeName,
  settlementAddress,
  origins,
  usdcReady,
  apiKeyHint,
  logo,
  paymaster,
}: {
  storeName: string;
  settlementAddress: string;
  origins: string;
  usdcReady: boolean | null;
  apiKeyHint: string | null;
  logo: string | null;
  paymaster: PaymasterView;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    saveSettings,
    {},
  );
  const values = state.values ?? { storeName, settlementAddress, origins };
  const [name, setName] = useState(values.storeName);
  const [address, setAddress] = useState(values.settlementAddress);
  const [originText, setOriginText] = useState(values.origins);
  const status = walletStatus(address.trim(), settlementAddress, usdcReady);
  const originList = splitOrigins(originText);
  return (
    <div className="grid items-start gap-6 xl:grid-cols-3">
      <div className="flex min-w-0 flex-col gap-6 xl:col-span-2">
        <Card>
          <Heading icon={RiStore2Line} color="blue" title="Store" />
          <LogoPicker name={name} logo={logo} />
          <form action={action} className="flex flex-col gap-5">
            <Input
              name="storeName"
              label="Name"
              isRequired
              defaultValue={values.storeName}
              onChange={setName}
            />
            <Divider />
            <Heading
              icon={RiWallet3Line}
              color="lime"
              title="Payout wallet"
              status={
                <Chip variant="caption" color={status.color}>
                  {status.label}
                </Chip>
              }
            />
            <Input
              name="settlementAddress"
              aria-label="Payout wallet (Solana)"
              defaultValue={values.settlementAddress}
              placeholder="Solana address"
              inputDir="ltr"
              onChange={setAddress}
              hint="USDC on Solana. Applies to new invoices."
            />
            <Divider />
            <Heading
              icon={RiCodeSSlashLine}
              color="purple"
              title="Embed origins"
            />
            <Input
              name="origins"
              aria-label="Embed origins"
              defaultValue={values.origins}
              placeholder="https://shop.example.com"
              inputDir="ltr"
              onChange={setOriginText}
              hint="https only, http for localhost."
            />
            {originList.length ? (
              <div className="flex flex-wrap gap-1.5">
                {originList.map((origin) => (
                  <Chip
                    key={origin}
                    variant="caption"
                    color="soft"
                    className="font-mono"
                  >
                    {origin}
                  </Chip>
                ))}
              </div>
            ) : null}
            {state.error ? <Notice tone="error">{state.error}</Notice> : null}
            <div className="flex items-center justify-end gap-3">
              {state.saved && !pending ? (
                <span className="text-caption-1-medium text-text-tertiary">
                  Saved
                </span>
              ) : null}
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        </Card>
        <PaymasterCard paymaster={paymaster} />
      </div>
      <CheckoutPreview storeName={name} address={address.trim()} logo={logo} />
    </div>
  );
}
