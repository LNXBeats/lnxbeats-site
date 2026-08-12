"use client";

import Image from "next/image";
import Link from "next/link";
import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useId, useRef, useState } from "react";

export type JukeboxProject = {
  slug: string;
  title: string;
  year: number | null;
  cover: string;
  coverAlt: string;
  audioPreview: { url: string; durationMs: number } | null;
};

type ProjectJukeboxProps = {
  projects: readonly JukeboxProject[];
  initialIndex: number;
  eyebrow: string;
  heading: string;
  variant: "published" | "development";
  eager?: boolean;
};

export function ProjectJukebox({ projects, initialIndex, eyebrow, heading, variant, eager = false }: ProjectJukeboxProps) {
  const safeInitialIndex = Math.min(Math.max(initialIndex, 0), Math.max(projects.length - 1, 0));
  const [activeSlug, setActiveSlug] = useState(projects[safeInitialIndex]?.slug ?? "");
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [continuousPlayback, setContinuousPlayback] = useState(false);

  const railRef = useRef<HTMLUListElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const programmaticRef = useRef(false);
  const playRequestRef = useRef(0);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const pointerDraggedRef = useRef(false);
  const regionId = useId();
  const playerId = `jukebox-${regionId}`;
  const matchedIndex = projects.findIndex(({ slug }) => slug === activeSlug);
  const activeIndex = matchedIndex >= 0 ? matchedIndex : safeInitialIndex;
  const active = projects[activeIndex];

  const shouldAutoplay = useCallback(
    (playbackAllowed: boolean, force = false) => playbackAllowed && (force || !audioUnlocked || continuousPlayback),
    [audioUnlocked, continuousPlayback],
  );

  const pauseCurrent = useCallback((preserveContinuous = true) => {
    const audio = audioRef.current;
    if (!audio) return;

    playRequestRef.current += 1;
    if (!audio.paused) audio.pause();
    audio.currentTime = 0;
    setProgress(0);
    setPlaying(false);
    if (!preserveContinuous) setContinuousPlayback(false);
  }, []);

  const syncTrackMedia = useCallback((index: number) => {
    const audio = audioRef.current;
    const target = projects[index];
    if (!audio) return;

    if (!target?.audioPreview) {
      audio.removeAttribute("src");
      audio.load();
      return;
    }

    const targetSrc = new URL(target.audioPreview.url, window.location.href).href;
    if (audio.src !== targetSrc) {
      audio.src = target.audioPreview.url;
      audio.load();
    }
  }, [projects]);

  const attemptPlayback = useCallback(async (index: number, playbackAllowed: boolean, force = false) => {
    const audio = audioRef.current;
    const target = projects[index];
    if (!audio || !target?.audioPreview || !shouldAutoplay(playbackAllowed, force)) return false;

    const requestId = ++playRequestRef.current;
    try {
      window.dispatchEvent(new CustomEvent("lnx-audio-preview-play", { detail: playerId }));
      await audio.play();
      if (requestId !== playRequestRef.current) return false;
      setAudioUnlocked(true);
      setContinuousPlayback(true);
      return true;
    } catch {
      if (requestId !== playRequestRef.current) return false;
      setAudioUnlocked(false);
      setContinuousPlayback(false);
      setPlaying(false);
      return false;
    }
  }, [playerId, projects, shouldAutoplay]);

  const select = useCallback((index: number, fromGesture = true) => {
    const maxIndex = Math.max(projects.length - 1, 0);
    const next = Math.min(Math.max(index, 0), maxIndex);
    const nextProject = projects[next];
    if (!nextProject || next === activeIndex) return;

    pauseCurrent();
    syncTrackMedia(next);
    setActiveSlug(nextProject.slug);

    const playbackAllowed = continuousPlayback;
    if (playbackAllowed && nextProject.audioPreview) {
      void attemptPlayback(next, playbackAllowed);
    }

    if (fromGesture) {
      programmaticRef.current = true;
      if (window.matchMedia("(max-width: 700px)").matches) {
        railRef.current?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
          block: "nearest",
          inline: "center",
        });
      }
      window.setTimeout(() => {
        programmaticRef.current = false;
      }, 360);
    }
  }, [activeIndex, attemptPlayback, continuousPlayback, pauseCurrent, projects, syncTrackMedia]);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio || !active.audioPreview) return;

    if (!audio.paused) {
      pauseCurrent(false);
      return;
    }

    await attemptPlayback(activeIndex, true, true);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    pointerStartRef.current = { x: event.clientX, y: event.clientY };
    pointerDraggedRef.current = false;
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = pointerStartRef.current;
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) {
      pointerDraggedRef.current = true;
    }
  };

  const handleCoverClick = (index: number) => {
    if (pointerDraggedRef.current) {
      pointerDraggedRef.current = false;
      return;
    }
    if (index === activeIndex) {
      void togglePlay();
      return;
    }
    select(activeIndex + Math.sign(index - activeIndex));
  };

  useEffect(() => {
    syncTrackMedia(activeIndex);
  }, [activeIndex, syncTrackMedia]);

  useEffect(() => {
    const stopOtherJukebox = (event: Event) => {
      if (!(event instanceof CustomEvent) || event.detail === playerId) return;
      pauseCurrent(false);
    };
    window.addEventListener("lnx-audio-preview-play", stopOtherJukebox);
    return () => window.removeEventListener("lnx-audio-preview-play", stopOtherJukebox);
  }, [pauseCurrent, playerId]);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail || !window.matchMedia("(max-width: 700px)").matches) return;

    const observer = new IntersectionObserver((entries) => {
      const candidate = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      const index = Number((candidate?.target as HTMLElement | undefined)?.dataset.index);
      if (!programmaticRef.current && Number.isInteger(index)) select(index, false);
    }, { root: rail, threshold: [0.55, 0.7] });

    rail.querySelectorAll<HTMLElement>("[data-index]").forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, [projects.length, select]);

  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      playRequestRef.current += 1;
      audio?.pause();
    };
  }, []);

  if (!active) return null;

  const playBadge = active.audioPreview ? (playing ? "Ⅱ" : (audioUnlocked ? "▸" : "▶ Écouter")) : null;
  const leftArrow = <span className="home-jukebox__arrow-track" aria-hidden="true"><span className="home-jukebox__arrow-line" /><span className="home-jukebox__arrow-symbol" /></span>;
  const rightArrow = <span className="home-jukebox__arrow-track" aria-hidden="true"><span className="home-jukebox__arrow-symbol" /><span className="home-jukebox__arrow-line" /></span>;

  return <section
    className={`home-jukebox home-jukebox--${variant} motion-reveal`}
    aria-labelledby={regionId}
    data-active-index={activeIndex}
    data-audio-unlocked={audioUnlocked}
    data-continuous-playback={continuousPlayback}
    data-playing={playing}
    data-variant={variant}
    onKeyDown={(event) => {
      if (event.key === "ArrowLeft" && activeIndex > 0) {
        event.preventDefault();
        select(activeIndex - 1);
      }
      if (event.key === "ArrowRight" && activeIndex < projects.length - 1) {
        event.preventDefault();
        select(activeIndex + 1);
      }
    }}
  >
    <div className="home-jukebox__background" aria-hidden="true" style={{ backgroundImage: `url(${active.cover})` }} />
    <div className="home-jukebox__heading">
      <div><p className="section-index">{eyebrow}</p><h3 id={regionId}>{heading}</h3></div>
      <output aria-live="polite">{activeIndex + 1} / {projects.length}</output>
    </div>
    <div className="home-jukebox__scene">
      {projects.length > 1 ? <button className="home-jukebox__arrow home-jukebox__arrow--previous" type="button" onClick={() => select(activeIndex - 1)} disabled={activeIndex === 0} aria-label="Projet précédent">{leftArrow}</button> : null}
      <ul className="home-jukebox__rail" ref={railRef} aria-label={`${eyebrow} — projets à parcourir`}>
        {projects.map((project, index) => {
          const distance = index - activeIndex;
          const position = distance === 0 ? "is-active" : distance === -1 ? "is-previous" : distance === 1 ? "is-next" : distance === -2 ? "is-far-previous" : distance === 2 ? "is-far-next" : distance < 0 ? "is-hidden-before" : "is-hidden-after";
          const preloadCover = Math.abs(distance) <= 1;
          const outsideImmediateSet = Math.abs(distance) > 1;

          return <li className={`home-jukebox__item ${position}`} data-index={index} aria-hidden={outsideImmediateSet || undefined} key={project.slug}>
            {index === activeIndex ? <button
              type="button"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onClick={() => handleCoverClick(index)}
              aria-current="true"
              aria-label={project.audioPreview ? (playing ? `Mettre en pause l’extrait de ${project.title}` : `Lire l’extrait de ${project.title}`) : `Projet ${project.title}, sans extrait`}
              disabled={!project.audioPreview}
            >
              <Image src={project.cover} alt={project.coverAlt} width={640} height={640} priority={eager && preloadCover} sizes="(max-width: 700px) 76vw, 520px" />
              {project.audioPreview ? <span className="home-jukebox__play" aria-hidden="true">{playBadge}</span> : null}
              {project.audioPreview ? <span className="home-jukebox__progress" style={{ transform: `scaleX(${progress})` }} aria-hidden="true" /> : null}
            </button> : <button
              type="button"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onClick={() => handleCoverClick(index)}
              aria-label={`Afficher ${project.title}`}
              tabIndex={outsideImmediateSet ? -1 : 0}
            >
              <Image src={project.cover} alt={project.coverAlt} width={360} height={360} priority={eager && preloadCover} sizes="(max-width: 700px) 76vw, 360px" />
            </button>}
          </li>;
        })}
      </ul>
      {projects.length > 1 ? <button className="home-jukebox__arrow home-jukebox__arrow--next" type="button" onClick={() => select(activeIndex + 1)} disabled={activeIndex === projects.length - 1} aria-label="Projet suivant">{rightArrow}</button> : null}
    </div>
    {projects.length > 1 ? <p className="home-jukebox__navigation-hint" aria-hidden="true"><span>← Faites défiler les projets →</span><span>Glissez pour parcourir</span></p> : null}
    <div className="home-jukebox__details">
      <div><p>{variant === "development" ? "En développement" : active.year ?? "LNX Beats"}</p><h4>{active.title}</h4></div>
      {active.audioPreview ? <p className="home-jukebox__excerpt">Extrait · {Math.round(active.audioPreview.durationMs / 60000)} min</p> : null}
      <Link className="text-link" href={`/album/${active.slug}`}>Découvrir le projet <span aria-hidden="true">→</span></Link>
    </div>
    <audio
      ref={audioRef}
      preload="metadata"
      onPlay={() => setPlaying(true)}
      onPause={() => setPlaying(false)}
      onEnded={() => { setPlaying(false); setProgress(0); }}
      onTimeUpdate={(event) => setProgress(event.currentTarget.duration ? event.currentTarget.currentTime / event.currentTarget.duration : 0)}
    />
  </section>;
}
