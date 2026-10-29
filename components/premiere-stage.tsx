"use client";

import type { ReactNode } from "react";
import { useBrandMotionPaused } from "@/components/brand-signature";

/** Shares the site's existing persistent motion control; never affects audio. */
export function PremiereStage({ className, children }: { className: string; children: ReactNode }) {
  const paused = useBrandMotionPaused();
  return <div className={className} data-motion-paused={paused}>{children}</div>;
}
