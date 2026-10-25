"use client";

import { useEffect, useRef } from "react";
import { useBrandMotionPaused } from "@/components/brand-signature";
import type { StudioScene, StudioSceneMode } from "@/lib/visual/studio-scene";

type ImmersiveSceneProps = {
  covers: readonly string[];
  index?: number;
  className?: string;
  mode?: StudioSceneMode;
};

/** Decorative enhancement only. The parent's real ProjectArtwork, links, titles
 * and audio controls remain the DOM fallback, including without JavaScript. */
export function ImmersiveScene({ covers, index = 0, className, mode = "hero" }: ImmersiveSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<StudioScene | null>(null);
  const indexRef = useRef(index);
  const paused = useBrandMotionPaused();
  const pausedRef = useRef(paused);
  // The caller may map its public catalogue on every render. A stable value key
  // avoids rebuilding the WebGL context when only the selected index changes.
  const coversKey = JSON.stringify(covers);

  useEffect(() => {
    indexRef.current = index;
    sceneRef.current?.setIndex(index);
  }, [index]);

  useEffect(() => {
    pausedRef.current = paused;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    sceneRef.current?.setMotion(!paused && !reduced);
  }, [paused]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const publicCovers: string[] = JSON.parse(coversKey);
    if (!publicCovers.length) return;
    let disposed = false;
    let started = false;
    let intersection: IntersectionObserver | null = null;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const syncMotion = () => sceneRef.current?.setMotion(!pausedRef.current && !reducedMotion.matches);
    const start = async () => {
      if (started || disposed) return;
      started = true;
      try {
        const { createStudioScene } = await import("@/lib/visual/studio-scene");
        if (disposed) return;
        sceneRef.current = createStudioScene(canvas, {
          covers: publicCovers,
          initialIndex: indexRef.current,
          mode,
          onReady: () => { if (!disposed) canvas.dataset.sceneReady = "true"; },
          onError: () => { if (!disposed) canvas.dataset.sceneReady = "false"; },
        });
        syncMotion();
      } catch {
        canvas.dataset.sceneReady = "false";
      }
    };
    const pointerMove = (event: PointerEvent) => {
      if (pausedRef.current || reducedMotion.matches || !finePointer.matches || event.pointerType === "touch") return;
      const rect = canvas.getBoundingClientRect();
      const within = rect.width > 0 && rect.height > 0 && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
      if (!within) { sceneRef.current?.setPointer(0, 0); return; }
      sceneRef.current?.setPointer((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
    };
    const scroll = () => {
      const rect = canvas.getBoundingClientRect();
      sceneRef.current?.setScroll(rect.height > 0 ? Math.max(0, Math.min(1, -rect.top / rect.height)) : 0);
    };
    const resized = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => sceneRef.current?.setMode(mode)) : null;
    resized?.observe(canvas);
    reducedMotion.addEventListener("change", syncMotion);
    window.addEventListener("pointermove", pointerMove, { passive: true });
    window.addEventListener("scroll", scroll, { passive: true });
    if (typeof IntersectionObserver !== "undefined") {
      intersection = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) { intersection?.disconnect(); void start(); }
      }, { rootMargin: "200px", threshold: 0 });
      intersection.observe(canvas);
    } else {
      void start();
    }
    return () => {
      disposed = true;
      intersection?.disconnect();
      resized?.disconnect();
      reducedMotion.removeEventListener("change", syncMotion);
      window.removeEventListener("pointermove", pointerMove);
      window.removeEventListener("scroll", scroll);
      sceneRef.current?.dispose();
      sceneRef.current = null;
      canvas.dataset.sceneReady = "false";
    };
  }, [coversKey, mode]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" tabIndex={-1} data-immersive-scene data-scene-ready="false" />;
}
