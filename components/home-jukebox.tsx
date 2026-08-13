"use client";

import Link from "next/link";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { ProjectArtwork } from "@/components/project-artwork";
import {
  discographyFilterCounts,
  filterDiscographyProjects,
  sortDiscographyProjects,
  type DiscographyFilter,
  type DiscographySort,
} from "@/lib/catalog/jukebox";
import {
  getProjectKindLabel,
  getProjectStatusLabel,
  type ArtworkTone,
  type ProjectKind,
  type ProjectStatus,
} from "@/lib/catalog/types";

export type JukeboxProject = {
  slug: string;
  title: string;
  type: ProjectKind;
  status: ProjectStatus;
  year: number | null;
  releaseDate: string | null;
  cover: string | null;
  coverAlt?: string;
  artworkTone: ArtworkTone;
  audioPreview: { url: string; durationMs: number } | null;
  featured: boolean;
  catalogPosition: number;
};

type ProjectJukeboxProps = {
  projects: readonly JukeboxProject[];
  initialIndex: number;
  eyebrow: string;
  heading: string;
  eager?: boolean;
};

const filterOptions: ReadonlyArray<{ value: DiscographyFilter; label: string }> = [
  { value: "all", label: "Tous" },
  { value: "albums", label: "Albums" },
  { value: "singles", label: "Singles" },
  { value: "development", label: "Projets en développement" },
];

const sortOptions: ReadonlyArray<{ value: DiscographySort; label: string }> = [
  { value: "editorial", label: "Ordre éditorial" },
  { value: "newest", label: "Plus récent" },
  { value: "oldest", label: "Plus ancien" },
];

function projectMeta(project: JukeboxProject) {
  const kind = getProjectKindLabel(project.type);
  if (project.status === "in-development") return `${kind} · ${getProjectStatusLabel(project.status)}`;
  return project.year ? `${kind} · ${project.year}` : kind;
}

export function ProjectJukebox({ projects, initialIndex, eyebrow, heading, eager = false }: ProjectJukeboxProps) {
  const safeInitialIndex = Math.min(Math.max(initialIndex, 0), Math.max(projects.length - 1, 0));
  const [activeSlug, setActiveSlug] = useState(projects[safeInitialIndex]?.slug ?? "");
  const [filter, setFilter] = useState<DiscographyFilter>("all");
  const [sort, setSort] = useState<DiscographySort>("editorial");
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
  const counts = useMemo(() => discographyFilterCounts(projects), [projects]);
  const visibleProjects = useMemo(
    () => sortDiscographyProjects(filterDiscographyProjects(projects, filter), sort),
    [filter, projects, sort],
  );
  const visibleActiveIndex = visibleProjects.findIndex(({ slug }) => slug === activeSlug);
  const globalIndexBySlug = useMemo(
    () => new Map(projects.map((project, index) => [project.slug, index])),
    [projects],
  );

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
      const focusWasInsideScene = railRef.current?.contains(document.activeElement) ?? false;
      if (window.matchMedia("(max-width: 700px)").matches) {
        railRef.current?.querySelector<HTMLElement>(`[data-project-index="${next}"]`)?.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
          block: "nearest",
          inline: "center",
        });
      }
      window.setTimeout(() => {
        programmaticRef.current = false;
        if (focusWasInsideScene) {
          const nextItem = railRef.current?.querySelector<HTMLElement>(`[data-project-index="${next}"]`);
          const nextControl = nextItem?.querySelector<HTMLElement>("[data-active-control='true']");
          (nextControl ?? nextItem)?.focus({ preventScroll: true });
        }
      }, 360);
    }
  }, [activeIndex, attemptPlayback, continuousPlayback, pauseCurrent, projects, syncTrackMedia]);

  const selectVisible = useCallback((index: number, fromGesture = true) => {
    const project = visibleProjects[index];
    const globalIndex = project ? globalIndexBySlug.get(project.slug) : undefined;
    if (globalIndex !== undefined) select(globalIndex, fromGesture);
  }, [globalIndexBySlug, select, visibleProjects]);

  const applyFilter = (nextFilter: DiscographyFilter) => {
    if (nextFilter === filter) return;
    const nextProjects = sortDiscographyProjects(filterDiscographyProjects(projects, nextFilter), sort);
    setFilter(nextFilter);
    if (nextProjects.some(({ slug }) => slug === activeSlug)) return;
    const nextIndex = nextProjects[0] ? globalIndexBySlug.get(nextProjects[0].slug) : undefined;
    if (nextIndex !== undefined) select(nextIndex);
  };

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
    select(index);
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
        .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
      const index = Number((candidate?.target as HTMLElement | undefined)?.dataset.projectIndex);
      if (!programmaticRef.current && Number.isInteger(index)) select(index, false);
    }, { root: rail, threshold: [0.55, 0.7] });

    rail.querySelectorAll<HTMLElement>("[data-project-index]").forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, [filter, select, sort, visibleProjects.length]);

  useEffect(() => {
    if (!window.matchMedia("(max-width: 700px)").matches) return;
    programmaticRef.current = true;
    const frame = window.requestAnimationFrame(() => {
      const index = globalIndexBySlug.get(activeSlug);
      if (index === undefined) return;
      railRef.current?.querySelector<HTMLElement>(`[data-project-index="${index}"]`)?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "nearest",
        inline: "center",
      });
    });
    const timer = window.setTimeout(() => {
      programmaticRef.current = false;
    }, 360);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [activeSlug, filter, globalIndexBySlug, sort]);

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
  const currentVisibleIndex = visibleActiveIndex >= 0 ? visibleActiveIndex : 0;

  return <section
    className="home-jukebox discography-jukebox motion-reveal"
    aria-labelledby={regionId}
    aria-roledescription="carrousel"
    data-active-index={activeIndex}
    data-audio-unlocked={audioUnlocked}
    data-continuous-playback={continuousPlayback}
    data-filter={filter}
    data-playing={playing}
    data-sort={sort}
    onKeyDown={(event) => {
      if ((event.target as HTMLElement).closest("select, input, textarea")) return;
      if (event.key === "ArrowLeft" && currentVisibleIndex > 0) {
        event.preventDefault();
        selectVisible(currentVisibleIndex - 1);
      }
      if (event.key === "ArrowRight" && currentVisibleIndex < visibleProjects.length - 1) {
        event.preventDefault();
        selectVisible(currentVisibleIndex + 1);
      }
    }}
  >
    <div className="home-jukebox__background" aria-hidden="true" />
    <div className="home-jukebox__heading">
      <div><p className="section-index">{eyebrow}</p><h1 id={regionId}>{heading}</h1></div>
      <output aria-live="polite" aria-atomic="true"><span className="visually-hidden">Projet actif : {active.title}. </span>{currentVisibleIndex + 1} / {visibleProjects.length}</output>
    </div>

    <div className="discography-jukebox__toolbar">
      <div className="discography-jukebox__filters" role="group" aria-label="Filtrer la discographie">
        {filterOptions.map((option) => <button
          type="button"
          key={option.value}
          aria-pressed={filter === option.value}
          disabled={counts[option.value] === 0}
          onClick={() => applyFilter(option.value)}
        >
          <span>{option.label}</span><strong>{counts[option.value]}</strong>
        </button>)}
      </div>
      <label className="discography-jukebox__sort">
        <span className="visually-hidden">Trier la discographie</span>
        <select value={sort} onChange={(event) => setSort(event.target.value as DiscographySort)}>
          {sortOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
        </select>
      </label>
    </div>

    <div className="home-jukebox__scene">
      {visibleProjects.length > 1 ? <button className="home-jukebox__arrow home-jukebox__arrow--previous" type="button" onClick={() => selectVisible(currentVisibleIndex - 1)} disabled={currentVisibleIndex === 0} aria-label="Projet précédent">{leftArrow}</button> : null}
      <ul className="home-jukebox__rail" ref={railRef} aria-label={`${eyebrow} — projets à parcourir`}>
        {visibleProjects.map((project, index) => {
          const distance = index - currentVisibleIndex;
          const position = distance === 0 ? "is-active" : distance === -1 ? "is-previous" : distance === 1 ? "is-next" : distance === -2 ? "is-far-previous" : distance === 2 ? "is-far-next" : distance < 0 ? "is-hidden-before" : "is-hidden-after";
          const preloadCover = Math.abs(distance) <= 1;
          const outsideScene = Math.abs(distance) > 2;
          const globalIndex = globalIndexBySlug.get(project.slug) ?? 0;
          const artwork = <ProjectArtwork project={project} priority={eager && preloadCover} sizes="(max-width: 700px) 78vw, (max-width: 1000px) 42vw, 430px" className="discography-card__artwork" />;

          return <li className={`home-jukebox__item ${position}`} data-project-index={globalIndex} aria-hidden={outsideScene || undefined} tabIndex={distance === 0 ? -1 : undefined} key={project.slug}>
            <article className="discography-card" data-active={distance === 0 || undefined} aria-current={distance === 0 ? "true" : undefined}>
              <div className="discography-card__art">
                {artwork}
                {distance === 0 && project.audioPreview ? <button
                  className="discography-card__play-hit"
                  type="button"
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onClick={() => handleCoverClick(globalIndex)}
                  aria-label={playing ? `Mettre en pause l’extrait de ${project.title}` : `Lire l’extrait de ${project.title}`}
                  data-active-control="true"
                ><span className="home-jukebox__play" aria-hidden="true">{playBadge}</span></button> : null}
                {distance === 0 && project.audioPreview ? <span className="home-jukebox__progress" style={{ transform: `scaleX(${progress})` }} aria-hidden="true" /> : null}
              </div>
              <div className="discography-card__body">
                <p>{projectMeta(project)}</p>
                <h3>{project.title}</h3>
                {distance === 0 ? <Link className="discography-card__link" href={`/album/${project.slug}`} aria-label={`Entrer dans le projet ${project.title}`} data-active-control="true">Entrer <span aria-hidden="true">→</span></Link> : null}
              </div>
              {distance !== 0 ? <button
                className="discography-card__select-hit"
                type="button"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onClick={() => handleCoverClick(globalIndex)}
                aria-label={`Afficher ${project.title}`}
                tabIndex={outsideScene ? -1 : 0}
              /> : null}
            </article>
          </li>;
        })}
      </ul>
      {visibleProjects.length > 1 ? <button className="home-jukebox__arrow home-jukebox__arrow--next" type="button" onClick={() => selectVisible(currentVisibleIndex + 1)} disabled={currentVisibleIndex === visibleProjects.length - 1} aria-label="Projet suivant">{rightArrow}</button> : null}
    </div>
    {visibleProjects.length > 1 ? <p className="home-jukebox__navigation-hint" aria-hidden="true"><span>← Faites défiler les projets →</span><span>Glissez pour parcourir</span></p> : null}
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
