"use client";

import Link from "next/link";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { ProjectArtwork } from "@/components/project-artwork";
import { StudioVinylControl, type StudioVinylControlState } from "@/components/studio-vinyl-control";
import {
  discographyFilterCounts,
  visibleDiscographyProjects,
  type DiscographyFilter,
  type DiscographySort,
} from "@/lib/catalog/jukebox";
import {
  initialJukeboxPlayerState,
  jukeboxPlayerMetadataSlug,
  reduceJukeboxPlayerState,
  type JukeboxPlayerAction,
} from "@/lib/catalog/jukebox-player";
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

const filterOptions: ReadonlyArray<{ value: DiscographyFilter; label: string; mobileLabel?: string }> = [
  { value: "all", label: "Tous" },
  { value: "albums", label: "Albums" },
  { value: "singles", label: "Singles" },
  { value: "development", label: "Projets en développement", mobileLabel: "En développement" },
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

function previewDuration(durationMs: number) {
  const seconds = Math.max(0, Math.round(durationMs / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function centerRailItem(rail: HTMLElement, item: HTMLElement, behavior: ScrollBehavior) {
  const railRect = rail.getBoundingClientRect();
  const itemRect = item.getBoundingClientRect();
  const targetLeft = rail.scrollLeft + itemRect.left - railRect.left - ((rail.clientWidth - itemRect.width) / 2);
  const maxLeft = Math.max(0, rail.scrollWidth - rail.clientWidth);
  rail.scrollTo({ left: Math.min(maxLeft, Math.max(0, targetLeft)), behavior });
}

export function ProjectJukebox({ projects, initialIndex, eyebrow, heading, eager = false }: ProjectJukeboxProps) {
  const safeInitialIndex = Math.min(Math.max(initialIndex, 0), Math.max(projects.length - 1, 0));
  const initialSlug = projects[safeInitialIndex]?.slug ?? "";
  const [playerState, dispatchPlayerState] = useReducer(
    reduceJukeboxPlayerState,
    initialSlug,
    initialJukeboxPlayerState,
  );
  const [filter, setFilter] = useState<DiscographyFilter>("all");
  const [sort, setSort] = useState<DiscographySort>("editorial");
  const [ended, setEnded] = useState(false);
  const [progress, setProgress] = useState(0);
  const [audioUnlocked, setAudioUnlocked] = useState(false);

  const railRef = useRef<HTMLUListElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const playerStateRef = useRef(playerState);
  const loadedSlugRef = useRef(initialSlug);
  const programmaticRef = useRef(false);
  const programmaticTimerRef = useRef<number | null>(null);
  const pendingCenterIndexRef = useRef<number | null>(null);
  const pendingFocusIndexRef = useRef<number | null>(null);
  const playRequestRef = useRef(0);
  const pendingPlayRef = useRef<{ requestId: number; slug: string } | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const pointerDraggedRef = useRef(false);
  const regionId = useId();
  const playerId = `jukebox-${regionId}`;
  const activeSlug = playerState.selectedSlug;
  const playingSlug = playerState.playingSlug;
  const playing = playingSlug !== null;
  const matchedIndex = projects.findIndex(({ slug }) => slug === activeSlug);
  const activeIndex = matchedIndex >= 0 ? matchedIndex : safeInitialIndex;
  const active = projects[activeIndex];
  const playerMetadataSlug = jukeboxPlayerMetadataSlug(playerState);
  const playerMetadataIndex = projects.findIndex(({ slug }) => slug === playerMetadataSlug);
  const playerProject = projects[playerMetadataIndex >= 0 ? playerMetadataIndex : activeIndex];
  const playingProject = playingSlug ? projects.find(({ slug }) => slug === playingSlug) ?? null : null;
  const counts = useMemo(() => discographyFilterCounts(projects), [projects]);
  const visibleProjects = useMemo(
    () => visibleDiscographyProjects(projects, filter, sort),
    [filter, projects, sort],
  );
  const visibleActiveIndex = visibleProjects.findIndex(({ slug }) => slug === activeSlug);
  const globalIndexBySlug = useMemo(
    () => new Map(projects.map((project, index) => [project.slug, index])),
    [projects],
  );

  const transitionPlayerState = useCallback((action: JukeboxPlayerAction) => {
    const next = reduceJukeboxPlayerState(playerStateRef.current, action);
    playerStateRef.current = next;
    dispatchPlayerState(action);
    return next;
  }, []);

  const pauseCurrent = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    playRequestRef.current += 1;
    pendingPlayRef.current = null;
    if (!audio.paused) audio.pause();
    audio.currentTime = 0;
    setProgress(0);
    const currentPlayingSlug = playerStateRef.current.playingSlug;
    if (currentPlayingSlug) transitionPlayerState({ type: "pause", slug: currentPlayingSlug });
  }, [transitionPlayerState]);

  const scheduleProgrammaticRelease = useCallback(() => {
    programmaticRef.current = true;
    if (programmaticTimerRef.current !== null) {
      window.clearTimeout(programmaticTimerRef.current);
    }
    programmaticTimerRef.current = window.setTimeout(() => {
      programmaticTimerRef.current = null;
      programmaticRef.current = false;
      const focusIndex = pendingFocusIndexRef.current;
      pendingFocusIndexRef.current = null;
      if (focusIndex === null) return;
      const nextItem = railRef.current?.querySelector<HTMLElement>(`[data-project-index="${focusIndex}"]`);
      const nextControl = nextItem?.querySelector<HTMLElement>("[data-active-control='true']");
      (nextControl ?? nextItem)?.focus({ preventScroll: true });
    }, 360);
  }, []);

  const clearProgrammaticTimer = useCallback(() => {
    if (programmaticTimerRef.current !== null) {
      window.clearTimeout(programmaticTimerRef.current);
      programmaticTimerRef.current = null;
    }
    programmaticRef.current = false;
    pendingCenterIndexRef.current = null;
    pendingFocusIndexRef.current = null;
  }, []);

  const syncTrackMedia = useCallback((index: number) => {
    const audio = audioRef.current;
    const target = projects[index];
    if (!audio || !target) return;

    if (loadedSlugRef.current !== target.slug) {
      playRequestRef.current += 1;
      pendingPlayRef.current = null;
      loadedSlugRef.current = target.slug;
      setProgress(0);
      setEnded(false);
    }

    if (!target.audioPreview) {
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

  const attemptPlayback = useCallback(async (index: number) => {
    const audio = audioRef.current;
    const target = projects[index];
    if (!audio || !target?.audioPreview) return false;

    syncTrackMedia(index);

    const requestId = ++playRequestRef.current;
    pendingPlayRef.current = { requestId, slug: target.slug };
    try {
      window.dispatchEvent(new CustomEvent("lnx-audio-preview-play", { detail: playerId }));
      await audio.play();
      if (requestId !== playRequestRef.current || loadedSlugRef.current !== target.slug || audio.paused) return false;
      pendingPlayRef.current = null;
      transitionPlayerState({ type: "play", slug: target.slug });
      setAudioUnlocked(true);
      return true;
    } catch {
      if (requestId !== playRequestRef.current || loadedSlugRef.current !== target.slug) return false;
      pendingPlayRef.current = null;
      setAudioUnlocked(false);
      transitionPlayerState({ type: "pause", slug: target.slug });
      return false;
    }
  }, [playerId, projects, syncTrackMedia, transitionPlayerState]);

  const select = useCallback((index: number, programmatic = true) => {
    const maxIndex = Math.max(projects.length - 1, 0);
    const next = Math.min(Math.max(index, 0), maxIndex);
    const nextProject = projects[next];
    if (!nextProject) return;
    const selectionChanged = nextProject.slug !== playerStateRef.current.selectedSlug;
    if (selectionChanged) {
      transitionPlayerState({ type: "select", slug: nextProject.slug });
      if (!playerStateRef.current.playingSlug) syncTrackMedia(next);
    }

    if (programmatic) {
      const focusWasInsideScene = railRef.current?.contains(document.activeElement) ?? false;
      pendingCenterIndexRef.current = next;
      pendingFocusIndexRef.current = selectionChanged && focusWasInsideScene ? next : null;
      scheduleProgrammaticRelease();
    } else {
      clearProgrammaticTimer();
    }
  }, [clearProgrammaticTimer, projects, scheduleProgrammaticRelease, syncTrackMedia, transitionPlayerState]);

  const selectVisible = useCallback((index: number, fromGesture = true) => {
    const project = visibleProjects[index];
    const globalIndex = project ? globalIndexBySlug.get(project.slug) : undefined;
    if (globalIndex !== undefined) select(globalIndex, fromGesture);
  }, [globalIndexBySlug, select, visibleProjects]);

  const applyFilter = (nextFilter: DiscographyFilter) => {
    if (nextFilter === filter) return;
    const nextProjects = visibleDiscographyProjects(projects, nextFilter, sort);
    setFilter(nextFilter);
    if (nextProjects.some(({ slug }) => slug === activeSlug)) {
      const currentIndex = globalIndexBySlug.get(activeSlug);
      if (currentIndex !== undefined) select(currentIndex);
      return;
    }
    const nextIndex = nextProjects[0] ? globalIndexBySlug.get(nextProjects[0].slug) : undefined;
    if (nextIndex !== undefined) select(nextIndex);
  };

  const applySort = (nextSort: DiscographySort) => {
    if (nextSort === sort) return;
    const nextProjects = visibleDiscographyProjects(projects, filter, nextSort);
    const nextIndex = nextProjects[0] ? globalIndexBySlug.get(nextProjects[0].slug) : undefined;
    setSort(nextSort);
    if (nextIndex !== undefined) select(nextIndex);
  };

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio || !active.audioPreview) return;

    if (playingSlug === active.slug && !audio.paused) {
      pauseCurrent();
      return;
    }

    if (playerStateRef.current.playingSlug) pauseCurrent();
    await attemptPlayback(activeIndex);
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
    playerStateRef.current = playerState;
  }, [playerState]);

  useEffect(() => {
    if (playerMetadataIndex >= 0) syncTrackMedia(playerMetadataIndex);
  }, [playerMetadataIndex, syncTrackMedia]);

  useEffect(() => {
    const index = pendingCenterIndexRef.current;
    if (index === null || !window.matchMedia("(max-width: 700px)").matches) return;

    const frame = window.requestAnimationFrame(() => {
      if (pendingCenterIndexRef.current !== index) return;
      pendingCenterIndexRef.current = null;
      const rail = railRef.current;
      const item = rail?.querySelector<HTMLElement>(`[data-project-index="${index}"]`);
      if (rail && item) {
        centerRailItem(rail, item, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activeSlug, filter, sort, visibleProjects.length]);

  useEffect(() => {
    const stopOtherJukebox = (event: Event) => {
      if (!(event instanceof CustomEvent) || event.detail === playerId) return;
      pauseCurrent();
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
    const audio = audioRef.current;
    return () => {
      clearProgrammaticTimer();
      playRequestRef.current += 1;
      pendingPlayRef.current = null;
      audio?.pause();
    };
  }, [clearProgrammaticTimer]);

  if (!active || !playerProject) return null;

  const selectedIsPlaying = playingSlug === active.slug;
  const selectedHasEnded = !playing && playerMetadataSlug === active.slug && ended;
  const playbackState = (selectedIsPlaying ? "pause" : selectedHasEnded ? "replay" : "play") satisfies StudioVinylControlState;
  const playBadge = active.audioPreview ? <>
    <StudioVinylControl state={playbackState} />
    {!selectedIsPlaying && !selectedHasEnded && !audioUnlocked ? <span className="home-jukebox__play-label">Écouter</span> : null}
  </> : null;
  const leftArrow = <span className="home-jukebox__arrow-track" aria-hidden="true"><span className="home-jukebox__arrow-line" /><span className="home-jukebox__arrow-symbol" /></span>;
  const rightArrow = <span className="home-jukebox__arrow-track" aria-hidden="true"><span className="home-jukebox__arrow-symbol" /><span className="home-jukebox__arrow-line" /></span>;
  const currentVisibleIndex = visibleActiveIndex >= 0 ? visibleActiveIndex : 0;

  return <section
    className="home-jukebox discography-jukebox motion-reveal"
    aria-labelledby={regionId}
    aria-roledescription="carrousel"
    data-motion-scene="jukebox"
    data-active-index={currentVisibleIndex}
    data-active-project-index={activeIndex}
    data-audio-unlocked={audioUnlocked}
    data-active-tone={active.artworkTone}
    data-filter={filter}
    data-player-duration-ms={playerProject.audioPreview?.durationMs ?? ""}
    data-player-project={playerProject.slug}
    data-player-source={playerProject.audioPreview?.url ?? ""}
    data-playing={playing}
    data-playing-project={playingSlug ?? ""}
    data-selection-playing-mismatch={playingProject && playingProject.slug !== active.slug ? true : undefined}
    data-selected-project={active.slug}
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
    <div className="home-jukebox__background" aria-hidden="true" data-motion-layer="background" />
    <div className="home-jukebox__heading">
      <div><p className="section-index">{eyebrow}</p><h1 id={regionId}>{heading}</h1></div>
      <output aria-live="polite" aria-atomic="true">
        <span className="visually-hidden">Projet actif : {active.title}. </span>
        {playingProject ? <span className="visually-hidden">En lecture : {playingProject.title}. </span> : null}
        <span className="home-jukebox__counter"><span>Projet</span> <strong>{currentVisibleIndex + 1}</strong> <span>sur</span> <strong>{visibleProjects.length}</strong></span>
      </output>
    </div>

    <div className="discography-jukebox__toolbar">
      <div className="discography-jukebox__filters" role="group" aria-label="Filtrer la discographie">
        {filterOptions.map((option) => <button
          type="button"
          key={option.value}
          aria-label={`${option.label} · ${counts[option.value]} projet${counts[option.value] > 1 ? "s" : ""}`}
          aria-pressed={filter === option.value}
          disabled={counts[option.value] === 0}
          onClick={() => applyFilter(option.value)}
        >
          <span className="discography-jukebox__filter-label discography-jukebox__filter-label--desktop">{option.label}</span>
          <span className="discography-jukebox__filter-label discography-jukebox__filter-label--mobile" aria-hidden="true">{option.mobileLabel ?? option.label}</span>
          <strong aria-hidden="true">{counts[option.value]}</strong>
        </button>)}
      </div>
      <label className="discography-jukebox__sort">
        <span className="visually-hidden">Trier la discographie</span>
        <select value={sort} onChange={(event) => applySort(event.target.value as DiscographySort)}>
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
          const artwork = <ProjectArtwork project={project} priority={eager && preloadCover} sizes="(max-width: 700px) 86vw, (max-width: 1000px) 42vw, (max-width: 1440px) 430px, (max-width: 2200px) 20vw, 500px" className="discography-card__artwork" />;

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
                  aria-label={selectedIsPlaying
                    ? `Mettre en pause l’extrait de ${project.title}`
                    : selectedHasEnded
                      ? `Relire l’extrait de ${project.title}`
                      : `Lire l’extrait de ${project.title}`}
                  data-active-control="true"
                ><span className="home-jukebox__play" aria-hidden="true">{playBadge}</span></button> : null}
                {playingSlug === project.slug && project.audioPreview ? <>
                  <span className="discography-card__playing" aria-hidden="true">En lecture</span>
                  <span className="home-jukebox__progress" style={{ transform: `scaleX(${progress})` }} aria-hidden="true" />
                </> : null}
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
    <div className="discography-jukebox__player-context" data-player-context>
      <div className="discography-jukebox__player-copy">
        <span>{playing ? "En lecture" : "Extrait sélectionné"}</span>
        <strong>{playerProject.title}</strong>
        <small>{playerProject.audioPreview ? `Extrait · ${previewDuration(playerProject.audioPreview.durationMs)}` : "Aucun extrait disponible"}</small>
      </div>
      {playingProject && playingProject.slug !== active.slug ? <p className="discography-jukebox__selected-context">Sélection affichée <strong>{active.title}</strong></p> : null}
      <button
        type="button"
        className="discography-jukebox__player-toggle"
        aria-label={playing ? `Mettre en pause l’extrait de ${playerProject.title}` : `Lire l’extrait de ${playerProject.title}`}
        disabled={!playerProject.audioPreview}
        onClick={() => { if (playing) pauseCurrent(); else void togglePlay(); }}
      >
        <StudioVinylControl state={(playing ? "pause" : selectedHasEnded ? "replay" : "play") satisfies StudioVinylControlState} />
      </button>
      <span className="discography-jukebox__player-progress" aria-hidden="true"><span style={{ transform: `scaleX(${progress})` }} /></span>
    </div>
    <audio
      ref={audioRef}
      preload="metadata"
      onPlay={(event) => {
        const sourceSlug = loadedSlugRef.current;
        const pendingPlay = pendingPlayRef.current;
        const expectedPlay = pendingPlay?.requestId === playRequestRef.current && pendingPlay.slug === sourceSlug;
        const settledPlay = playerStateRef.current.playingSlug === sourceSlug;
        if (!sourceSlug || event.currentTarget.paused || (!expectedPlay && !settledPlay)) {
          if (!event.currentTarget.paused) event.currentTarget.pause();
          return;
        }
        setEnded(false);
      }}
      onPause={(event) => {
        const sourceSlug = loadedSlugRef.current;
        if (!sourceSlug || !event.currentTarget.paused) return;
        transitionPlayerState({ type: "pause", slug: sourceSlug });
      }}
      onEnded={(event) => {
        const sourceSlug = loadedSlugRef.current;
        if (!sourceSlug || !event.currentTarget.ended) return;
        transitionPlayerState({ type: "pause", slug: sourceSlug });
        setProgress(0);
        setEnded(playerStateRef.current.selectedSlug === sourceSlug);
      }}
      onTimeUpdate={(event) => {
        const metadataSlug = jukeboxPlayerMetadataSlug(playerStateRef.current);
        if (loadedSlugRef.current !== metadataSlug) return;
        setProgress(event.currentTarget.duration ? event.currentTarget.currentTime / event.currentTarget.duration : 0);
      }}
    />
  </section>;
}
