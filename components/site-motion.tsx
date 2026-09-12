"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

const REVEAL_SELECTOR = ".motion-reveal";
const SCENE_SELECTOR = "[data-motion-scene]";
const TILT_SELECTOR = "[data-motion-tilt]";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const MOTION_PREFERENCE_QUERY = "(prefers-reduced-motion: no-preference)";
const FINE_POINTER_QUERY = "(hover: hover) and (pointer: fine)";
const MOTION_EASING = 0.14;
const MOTION_EPSILON = 0.002;

type MotionTarget = {
  element: HTMLElement;
  currentX: number;
  currentY: number;
  targetX: number;
  targetY: number;
  lastPointerX: number;
  lastPointerY: number;
  pointerInside: boolean;
  handlePointerMove: (event: PointerEvent) => void;
  handlePointerLeave: () => void;
};

function clampMotion(value: number) {
  return Math.min(1, Math.max(-1, value));
}

function writeMotion(element: HTMLElement, x: number, y: number) {
  element.style.setProperty("--motion-x", x.toFixed(4));
  element.style.setProperty("--motion-y", y.toFixed(4));
  element.style.setProperty("--motion-light-x", `${(50 + (x * 50)).toFixed(2)}%`);
  element.style.setProperty("--motion-light-y", `${(50 + (y * 50)).toFixed(2)}%`);
}

function resetMotion(element: HTMLElement, removeProperties = false) {
  if (removeProperties) {
    element.style.removeProperty("--motion-x");
    element.style.removeProperty("--motion-y");
    element.style.removeProperty("--motion-light-x");
    element.style.removeProperty("--motion-light-y");
    return;
  }

  writeMotion(element, 0, 0);
}

export function SiteMotion() {
  const pathname = usePathname();

  useEffect(() => {
    const main = document.querySelector<HTMLElement>("main#contenu");
    if (!main) return;

    const reducedMotion = window.matchMedia(REDUCED_MOTION_QUERY);
    let enterTimer: number | null = null;
    let leaveTimer: number | null = null;
    const clearTimers = () => {
      if (enterTimer !== null) window.clearTimeout(enterTimer);
      if (leaveTimer !== null) window.clearTimeout(leaveTimer);
      enterTimer = null;
      leaveTimer = null;
    };

    main.classList.remove("route-motion-enter");
    if (!reducedMotion.matches) {
      enterTimer = window.setTimeout(() => {
        enterTimer = null;
        if (reducedMotion.matches) return;
        main.classList.add("route-motion-enter");
        leaveTimer = window.setTimeout(() => {
          leaveTimer = null;
          main.classList.remove("route-motion-enter");
        }, 860);
      }, 0);
    }

    const handleReducedMotionChange = () => {
      if (!reducedMotion.matches) return;
      clearTimers();
      main.classList.remove("route-motion-enter");
    };
    reducedMotion.addEventListener("change", handleReducedMotionChange);

    return () => {
      reducedMotion.removeEventListener("change", handleReducedMotionChange);
      clearTimers();
      main.classList.remove("route-motion-enter");
    };
  }, [pathname]);

  useEffect(() => {
    const reducedMotion = window.matchMedia(REDUCED_MOTION_QUERY);
    const reveals = Array.from(document.querySelectorAll<HTMLElement>(REVEAL_SELECTOR));
    let observer: IntersectionObserver | null = null;

    const revealImmediately = () => {
      observer?.disconnect();
      observer = null;
      reveals.forEach((element) => {
        element.classList.remove("motion-reveal--pending");
        element.classList.add("is-revealed");
      });
    };

    if (reducedMotion.matches || !("IntersectionObserver" in window)) {
      revealImmediately();
    } else {
      reveals.forEach((element) => element.classList.add("motion-reveal--pending"));
      observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-revealed");
          observer?.unobserve(entry.target);
        });
      }, { rootMargin: "0px 0px -10%", threshold: 0.12 });
      reveals.forEach((element) => observer?.observe(element));
    }

    const handleReducedMotionChange = () => {
      if (reducedMotion.matches) revealImmediately();
    };
    reducedMotion.addEventListener("change", handleReducedMotionChange);

    return () => {
      reducedMotion.removeEventListener("change", handleReducedMotionChange);
      observer?.disconnect();
      reveals.forEach((element) => element.classList.remove("motion-reveal--pending"));
    };
  }, [pathname]);

  useEffect(() => {
    const finePointer = window.matchMedia(FINE_POINTER_QUERY);
    const motionPreference = window.matchMedia(MOTION_PREFERENCE_QUERY);
    let enabled = false;
    let frame = 0;
    let targets: MotionTarget[] = [];

    const scheduleFrame = () => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(runFrame);
    };

    const runFrame: FrameRequestCallback = () => {
      frame = 0;
      let needsAnotherFrame = false;

      targets.forEach((target) => {
        if (target.pointerInside) {
          const rect = target.element.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            target.targetX = clampMotion((((target.lastPointerX - rect.left) / rect.width) - 0.5) * 2);
            target.targetY = clampMotion((((target.lastPointerY - rect.top) / rect.height) - 0.5) * 2);
          }
        }

        const nextX = Math.abs(target.targetX - target.currentX) <= MOTION_EPSILON
          ? target.targetX
          : target.currentX + ((target.targetX - target.currentX) * MOTION_EASING);
        const nextY = Math.abs(target.targetY - target.currentY) <= MOTION_EPSILON
          ? target.targetY
          : target.currentY + ((target.targetY - target.currentY) * MOTION_EASING);

        target.currentX = nextX;
        target.currentY = nextY;
        writeMotion(target.element, nextX, nextY);
        if (nextX !== target.targetX || nextY !== target.targetY) needsAnotherFrame = true;
      });

      if (needsAnotherFrame) scheduleFrame();
    };

    const detachTargets = (removeProperties = false) => {
      enabled = false;
      if (frame !== 0) window.cancelAnimationFrame(frame);
      frame = 0;
      targets.forEach((target) => {
        target.element.removeEventListener("pointermove", target.handlePointerMove);
        target.element.removeEventListener("pointerleave", target.handlePointerLeave);
        target.element.removeEventListener("pointercancel", target.handlePointerLeave);
        resetMotion(target.element, removeProperties);
      });
      targets = [];
    };

    const attachTargets = () => {
      enabled = true;
      const elements = Array.from(new Set(document.querySelectorAll<HTMLElement>(`${SCENE_SELECTOR}, ${TILT_SELECTOR}`)));
      targets = elements.map((element) => {
        const target: MotionTarget = {
          element,
          currentX: 0,
          currentY: 0,
          targetX: 0,
          targetY: 0,
          lastPointerX: 0,
          lastPointerY: 0,
          pointerInside: false,
          handlePointerMove: () => undefined,
          handlePointerLeave: () => undefined,
        };

        target.handlePointerMove = (event: PointerEvent) => {
          target.lastPointerX = event.clientX;
          target.lastPointerY = event.clientY;
          target.pointerInside = true;
          scheduleFrame();
        };
        target.handlePointerLeave = () => {
          target.pointerInside = false;
          target.targetX = 0;
          target.targetY = 0;
          scheduleFrame();
        };

        resetMotion(element);
        element.addEventListener("pointermove", target.handlePointerMove, { passive: true });
        element.addEventListener("pointerleave", target.handlePointerLeave);
        element.addEventListener("pointercancel", target.handlePointerLeave);
        return target;
      });
    };

    const syncMotionMode = () => {
      const shouldEnable = finePointer.matches && motionPreference.matches;
      if (shouldEnable === enabled) return;
      if (shouldEnable) attachTargets();
      else detachTargets();
    };

    finePointer.addEventListener("change", syncMotionMode);
    motionPreference.addEventListener("change", syncMotionMode);
    syncMotionMode();

    return () => {
      finePointer.removeEventListener("change", syncMotionMode);
      motionPreference.removeEventListener("change", syncMotionMode);
      detachTargets(true);
    };
  }, [pathname]);

  return null;
}
