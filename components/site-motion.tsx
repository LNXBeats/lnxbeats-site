"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

const REVEAL_SELECTOR = ".motion-reveal";
const SCENE_SELECTOR = "[data-motion-scene]";

export function SiteMotion() {
  const pathname = usePathname();

  useEffect(() => {
    const main = document.querySelector<HTMLElement>("main#contenu");
    if (!main) return;

    main.classList.remove("route-motion-enter");
    const frame = window.requestAnimationFrame(() => main.classList.add("route-motion-enter"));
    const timer = window.setTimeout(() => main.classList.remove("route-motion-enter"), 560);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      main.classList.remove("route-motion-enter");
    };
  }, [pathname]);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const reveals = Array.from(document.querySelectorAll<HTMLElement>(REVEAL_SELECTOR));

    if (reducedMotion.matches || !("IntersectionObserver" in window)) {
      reveals.forEach((element) => element.classList.add("is-revealed"));
      return;
    }

    reveals.forEach((element) => element.classList.add("motion-reveal--pending"));
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-revealed");
        observer.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -10%", threshold: 0.12 });

    reveals.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [pathname]);

  useEffect(() => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const scenes = Array.from(document.querySelectorAll<HTMLElement>(SCENE_SELECTOR));
    const cleanups = scenes.map((scene) => {
      let frame = 0;
      const reset = () => {
        scene.style.setProperty("--motion-x", "0");
        scene.style.setProperty("--motion-y", "0");
      };
      const handlePointerMove = (event: PointerEvent) => {
        if (frame) return;
        frame = window.requestAnimationFrame(() => {
          frame = 0;
          const rect = scene.getBoundingClientRect();
          const x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
          const y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
          scene.style.setProperty("--motion-x", x.toFixed(3));
          scene.style.setProperty("--motion-y", y.toFixed(3));
        });
      };

      scene.addEventListener("pointermove", handlePointerMove, { passive: true });
      scene.addEventListener("pointerleave", reset);
      return () => {
        if (frame) window.cancelAnimationFrame(frame);
        scene.removeEventListener("pointermove", handlePointerMove);
        scene.removeEventListener("pointerleave", reset);
        reset();
      };
    });

    return () => cleanups.forEach((cleanup) => cleanup());
  }, [pathname]);

  return null;
}
