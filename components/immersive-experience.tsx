"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { BrandMotionToggle, useBrandMotionPaused } from "./brand-signature";

/** Presentation only. No audio is started and no business state is written here. */
export function ImmersiveExperience() {
  const pathname = usePathname();
  const paused = useBrandMotionPaused();
  const showControl = pathname === "/" || pathname === "/discographie" || pathname.startsWith("/album/");
  useEffect(() => {
    document.documentElement.dataset.visualMotion = paused ? "paused" : "on";
    return () => { delete document.documentElement.dataset.visualMotion; };
  }, [paused]);
  // Checkout and forms stay calm; the shared footer control remains available.
  if (!showControl) return null;
  return <aside className="immersive-experience-control"><span aria-hidden="true">◌</span><BrandMotionToggle /></aside>;
}
