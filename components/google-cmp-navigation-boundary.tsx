"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { allowsAdSlot } from "@/lib/ads/policy";

/** A CMP document must not survive navigation into excluded/private routes.
 * A full navigation also supplies a fresh nonce when entering from those routes.
 * No provider script, storage or advertising request is created here.
 */
export function GoogleCmpNavigationBoundary({ enabled }: { enabled: boolean }) {
  const pathname = usePathname();
  const eligible = allowsAdSlot(pathname, "footer") || allowsAdSlot(pathname, "content");
  const documentEligible = useRef(eligible);
  useEffect(() => {
    if (enabled && documentEligible.current !== eligible) window.location.replace(window.location.href);
  }, [eligible, enabled]);
  return null;
}
