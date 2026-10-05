import { allowsAdSlot, type AdSlot } from "@/lib/ads/policy";

export type TcfData = {
  cmpStatus?: string;
  eventStatus?: string;
  tcString?: string;
  listenerId?: number;
  purpose?: { consents?: Record<number, boolean> };
  vendor?: { consents?: Record<number, boolean> };
};
export type ConsentState = "unknown" | "denied" | "granted";

// This is a conservative gate, NOT a CMP or a TCF string generator.
// Google still validates the full TC string and its own vendor requirements.
// No gdprApplies=false shortcut: absent consent never means consent.
export function googleConsentState(data: TcfData | undefined, success: boolean): ConsentState {
  if (!success || data?.cmpStatus !== "loaded" || !data.tcString
    || !["tcloaded", "useractioncomplete"].includes(data.eventStatus ?? "")) return "unknown";
  return data.vendor?.consents?.[755] === true
    && [1, 3, 4].every(id => data.purpose?.consents?.[id] === true) ? "granted" : "denied";
}

export function mayRequestAd(pathname: string, slot: AdSlot, enabled: boolean, state: ConsentState) {
  return enabled && allowsAdSlot(pathname, slot) && state === "granted";
}

// Adapter contract tested without loading any ad network or fabricating a CMP UI.
export function createConsentGate(onChange: (state: ConsentState) => void) {
  let active = true;
  onChange("unknown");
  return {
    update(data: TcfData | undefined, success: boolean) { if (active) onChange(googleConsentState(data, success)); },
    revoke() { if (active) onChange("unknown"); },
    dispose() { active = false; onChange("unknown"); },
  };
}
