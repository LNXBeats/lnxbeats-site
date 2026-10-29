"use client";

import Link from "next/link";
import { OriginalName } from "@/components/original-name";
import { T, useSiteLanguage } from "@/components/site-language";
import { UiIcon } from "@/components/ui-icon";
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
  DEFAULT_DISCOGRAPHY_SORT,
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
import { announceMediaPlayback, listenForOtherMediaPlayback } from "@/lib/media/playback-coordinator";

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
  membersPreviewOnly?: boolean;
  featured: boolean;
  catalogPosition: number;
  jukeboxPosition: number | null;
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
  { value: "newest", label: "Plus récent" },
  { value: "oldest", label: "Plus ancien" },
  { value: "editorial", label: "Ordre éditorial" },
];

function projectMeta(project: JukeboxProject, t: (source: string) => string) {
  const kind = t(getProjectKindLabel(project.type));
  if (project.status === "in-development") return `${kind} · ${t(getProjectStatusLabel(project.status))}`;
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
  const { t } = useSiteLanguage();
  const safeInitialIndex = Math.min(Math.max(initialIndex, 0), Math.max(projects.length - 1, 0));
  const initialSlug = projects[safeInitialIndex]?.slug ?? "";
  const [playerState, dispatchPlayerState] = useReducer(
    reduceJukeboxPlayerState,
    initialSlug,
    initialJukeboxPlayerState,
  );
  const [filter, setFilter] = useState<DiscographyFilter>("all");
  const [sort, setSort] = useState<DiscographySort>(DEFAULT_DISCOGRAPHY_SORT);
  const [ended, setEnded] = useState(false);
  const [progress, setProgress] = useState(0);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [playbackFailure, setPlaybackFailure] = useState<"blocked" | "unavailable" | null>(null);
  const [playbackLoading, setPlaybackLoading] = useState(false);
  const [machineVisible, setMachineVisible] = useState(true);
  const [machineEngaged, setMachineEngaged] = useState(false);
  const [seatedRecordSlug, setSeatedRecordSlug] = useState<string | null>(null);
  const [motionSuppressed, setMotionSuppressed] = useState(false);

  const railRef = useRef<HTMLUListElement>(null);
  const machineRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const playerStateRef = useRef(playerState);
  const loadedSlugRef = useRef(initialSlug);
  const programmaticRef = useRef(false);
  const programmaticTimerRef = useRef<number | null>(null);
  const pendingCenterIndexRef = useRef<number | null>(null);
  const pendingFocusIndexRef = useRef<number | null>(null);
  const playRequestRef = useRef(0);
  const pendingPlayRef = useRef<{ requestId: number; slug: string } | null>(null);
  const continuousListeningRef = useRef(false);
  const externallyPausedSourceRef = useRef<string | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const pointerDraggedRef = useRef(false);
  const sceneSwipeRef = useRef<{ x: number; y: number } | null>(null);
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

  const pauseCurrent = useCallback((resetPosition = true, disableContinuity = true) => {
    const audio = audioRef.current;
    if (!audio) return;

    playRequestRef.current += 1;
    pendingPlayRef.current = null;
    setPlaybackLoading(false);
    if (disableContinuity) {
      continuousListeningRef.current = false;
      setAudioUnlocked(false);
    }
    if (!audio.paused) audio.pause();
    if (resetPosition) {
      audio.currentTime = 0;
      setProgress(0);
    }
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
      const nextControl = machineRef.current?.querySelector<HTMLElement>(".mechanical-jukebox__project-link");
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
    setPlaybackFailure(null);
    setPlaybackLoading(true);
    try {
      announceMediaPlayback({ ownerId: playerId, kind: "audio" });
      await audio.play();
      if (requestId !== playRequestRef.current || loadedSlugRef.current !== target.slug) return false;
      if (audio.paused) {
        pendingPlayRef.current = null;
        continuousListeningRef.current = false;
        setAudioUnlocked(false);
        setPlaybackLoading(false);
        return false;
      }
      pendingPlayRef.current = null;
      transitionPlayerState({ type: "play", slug: target.slug });
      setMachineEngaged(true);
      continuousListeningRef.current = true;
      setAudioUnlocked(true);
      setPlaybackLoading(false);
      return true;
    } catch (error) {
      if (requestId !== playRequestRef.current || loadedSlugRef.current !== target.slug) return false;
      pendingPlayRef.current = null;
      continuousListeningRef.current = false;
      setAudioUnlocked(false);
      setPlaybackLoading(false);
      setPlaybackFailure(error instanceof Error && error.name === "NotAllowedError" ? "blocked" : "unavailable");
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
      setSeatedRecordSlug(motionSuppressed ? nextProject.slug : null);
      setMachineEngaged(true);
      const continueListening = continuousListeningRef.current;
      pauseCurrent(true, false);
      transitionPlayerState({ type: "select", slug: nextProject.slug });
      setPlaybackFailure(null);
      syncTrackMedia(next);
      if (continueListening && nextProject.audioPreview) void attemptPlayback(next);
    }

    if (programmatic) {
      const focusWasInsideScene = railRef.current?.contains(document.activeElement) ?? false;
      pendingCenterIndexRef.current = next;
      pendingFocusIndexRef.current = selectionChanged && focusWasInsideScene ? next : null;
      scheduleProgrammaticRelease();
    } else {
      clearProgrammaticTimer();
    }
  }, [attemptPlayback, clearProgrammaticTimer, motionSuppressed, pauseCurrent, projects, scheduleProgrammaticRelease, syncTrackMedia, transitionPlayerState]);

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

    if (pendingPlayRef.current) {
      pauseCurrent();
      return;
    }

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
    const externallyPausedSource = externallyPausedSourceRef.current;
    externallyPausedSourceRef.current = null;
    if (externallyPausedSource && loadedSlugRef.current === externallyPausedSource) return;
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
    return listenForOtherMediaPlayback(playerId, () => {
      const audio = audioRef.current;
      const playbackPending = pendingPlayRef.current !== null;
      const playbackActive = playerStateRef.current.playingSlug !== null || !audio?.paused;
      if (!audio || (!playbackPending && !playbackActive)) return;
      if (loadedSlugRef.current !== playerStateRef.current.selectedSlug) {
        externallyPausedSourceRef.current = loadedSlugRef.current;
      }
      pauseCurrent(false);
    });
  }, [pauseCurrent, playerId]);

  useEffect(() => {
    const machine = machineRef.current;
    if (!machine) return;
    let intersects = true;
    const syncVisibility = () => setMachineVisible(intersects && !document.hidden);
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => {
      intersects = entries[0]?.isIntersecting ?? true;
      syncVisibility();
    }, { threshold: .02 });
    observer?.observe(machine);
    document.addEventListener("visibilitychange", syncVisibility);
    syncVisibility();
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", syncVisibility);
    };
  }, []);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = () => {
      const suppressed = preference.matches || document.documentElement.dataset.visualMotion === "paused";
      setMotionSuppressed(suppressed);
      // With motion disabled, the record is already displayed on its platter.
      // Remember this so re-enabling motion cannot restart a completed transfer.
      if (suppressed) setSeatedRecordSlug(playerStateRef.current.selectedSlug);
    };
    const observer = new MutationObserver(syncPreference);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-visual-motion"] });
    syncPreference();
    preference.addEventListener("change", syncPreference);
    return () => {
      observer.disconnect();
      preference.removeEventListener("change", syncPreference);
    };
  }, []);

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

  const selectedHasEnded = !playing && playerMetadataSlug === active.slug && ended;
  const playbackState: StudioVinylControlState = playbackLoading ? "loading" : playing ? "pause" : selectedHasEnded ? "replay" : "play";
  const leftArrow = <span className="home-jukebox__arrow-track" aria-hidden="true"><span className="home-jukebox__arrow-line" /><span className="home-jukebox__arrow-symbol" /></span>;
  const rightArrow = <span className="home-jukebox__arrow-track" aria-hidden="true"><span className="home-jukebox__arrow-symbol" /><span className="home-jukebox__arrow-line" /></span>;
  const currentVisibleIndex = visibleActiveIndex >= 0 ? visibleActiveIndex : 0;

  return <section
    className="home-jukebox discography-jukebox mechanical-jukebox motion-reveal"
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
    data-machine-engaged={machineEngaged}
    data-record-seated={seatedRecordSlug === active.slug || motionSuppressed}
    data-tonearm-engaged={playingSlug === active.slug && (seatedRecordSlug === active.slug || motionSuppressed)}
    data-playback-loading={playbackLoading}
    data-playback-failure={playbackFailure ?? ""}
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
      <div><p className="section-index"><T text={eyebrow}/></p><h1 id={regionId}>{t(heading)}</h1></div>
      <output aria-live="polite" aria-atomic="true">
        <span className="visually-hidden">{t("Projet actif")} : <OriginalName>{active.title}</OriginalName>. </span>
        {playingProject ? <span className="visually-hidden">{t("En lecture")} : <OriginalName>{playingProject.title}</OriginalName>. </span> : null}
        <span className="home-jukebox__counter"><span>{t("Projet")}</span> <strong>{currentVisibleIndex + 1}</strong> <span>{t("sur")}</span> <strong>{visibleProjects.length}</strong></span>
      </output>
    </div>

    <div className="discography-jukebox__toolbar">
      <div className="discography-jukebox__filters" role="group" aria-label={t("Filtrer la discographie")}>
        {filterOptions.map((option) => <button
          type="button"
          key={option.value}
          aria-label={`${t(option.label)} · ${counts[option.value]}`}
          aria-pressed={filter === option.value}
          disabled={counts[option.value] === 0}
          onClick={() => applyFilter(option.value)}
        >
          <span className="discography-jukebox__filter-label discography-jukebox__filter-label--desktop">{t(option.label)}</span>
          <span className="discography-jukebox__filter-label discography-jukebox__filter-label--mobile" aria-hidden="true">{t(option.mobileLabel ?? option.label)}</span>
          <strong aria-hidden="true">{counts[option.value]}</strong>
        </button>)}
      </div>
      <label className="discography-jukebox__sort">
        <span className="visually-hidden">{t("Trier la discographie")}</span>
        <select value={sort} onChange={(event) => applySort(event.target.value as DiscographySort)}>
          {sortOptions.map((option) => <option value={option.value} key={option.value}>{t(option.label)}</option>)}
        </select>
      </label>
    </div>

    <div className="home-jukebox__scene" ref={machineRef} data-machine-visible={machineVisible}
      onPointerDown={event => {
        if (event.button !== 0 || (event.target as HTMLElement).closest("a,button,input,select")) return;
        sceneSwipeRef.current = { x: event.clientX, y: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerCancel={() => { sceneSwipeRef.current = null; }}
      onPointerUp={event => {
        const start = sceneSwipeRef.current;
        sceneSwipeRef.current = null;
        if (!start) return;
        const dx = event.clientX - start.x, dy = event.clientY - start.y;
        if (Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy) * 1.4) selectVisible(currentVisibleIndex + (dx < 0 ? 1 : -1));
      }}>
      <div className="mechanical-jukebox__hardware" aria-hidden="true">
        <div className="mechanical-jukebox__nameplate"><span translate="no">LNX BEATS</span><i /> <span>STUDIO SELECTOR</span></div>
        <span className="mechanical-jukebox__serial">{String(currentVisibleIndex + 1).padStart(2, "0")} / {String(visibleProjects.length).padStart(2, "0")}</span>
        <div className="mechanical-jukebox__rack-light" />
        <div className="mechanical-jukebox__rack-base" />
        <div className="mechanical-jukebox__deck"><span className="mechanical-jukebox__deck-line" /><span className="mechanical-jukebox__deck-mark">LNX · DIRECT DRIVE</span><i className="mechanical-jukebox__dial mechanical-jukebox__dial--one" /><i className="mechanical-jukebox__dial mechanical-jukebox__dial--two" /></div>
        <div className="mechanical-jukebox__platter"><i /><i /><i /></div>
        {/* The arm and record share one projected coordinate system. The fixed
            pivot never moves; the connected tube, cartridge and diamond do. */}
        <svg className="mechanical-jukebox__tonearm" viewBox="0 0 400 400" focusable="false">
          <defs>
            <linearGradient id={`${playerId}-chrome`} x1="0" y1="0" x2="0.35" y2="1"><stop stopColor="#fafaf3" /><stop offset=".24" stopColor="#99a4a7" /><stop offset=".45" stopColor="#eff4f2" /><stop offset=".65" stopColor="#637078" /><stop offset="1" stopColor="#c5cdcb" /></linearGradient>
          </defs>
          <g className="mechanical-jukebox__tonearm-base">
            <ellipse cx="470" cy="113" rx="39" ry="37" fill="#1b2225" />
            <circle cx="470" cy="105" r="37" fill={`url(#${playerId}-chrome)`} stroke="#f1eee0" strokeWidth="2" />
            <circle cx="470" cy="105" r="24" fill="#555f63" stroke="#aab4b4" strokeWidth="5" />
            <circle cx="470" cy="105" r="12" fill="#20292d" />
            <path d="M479 245V317M465 265H490" stroke="#a5afac" strokeWidth="9" strokeLinecap="round" />
          </g>
          <g className="mechanical-jukebox__tonearm-swing">
            <g className="mechanical-jukebox__tonearm-lift">
              <path d="M493 72L470 105" stroke="#58676c" strokeWidth="16" strokeLinecap="round" />
              <path d="M493 72L470 105" stroke={`url(#${playerId}-chrome)`} strokeWidth="11" strokeLinecap="round" />
              <path d="M470 105C463 144 426 154 422 192S408 240 363 268L338 287" className="mechanical-jukebox__tonearm-rod" fill="none" stroke={`url(#${playerId}-chrome)`} strokeWidth="12" strokeLinecap="round" />
              <path d="M468 108C459 144 423 153 419 192S405 237 360 265" fill="none" stroke="#ffffffb3" strokeWidth="2" strokeLinecap="round" />
              <rect x="478" y="51" width="35" height="39" rx="9" transform="rotate(35 495 71)" fill={`url(#${playerId}-chrome)`} stroke="#6d797d" strokeWidth="2" />
              <path d="M346 268L321 291L335 305L362 280Z" className="mechanical-jukebox__tonearm-head" fill={`url(#${playerId}-chrome)`} stroke="#5f6d70" strokeWidth="2" />
              <path d="M330 291L335 299L347 291L342 284Z" fill="#367b51" stroke="#153b29" strokeWidth="2" />
              <path d="M340 289L335 290" stroke="#f5db9a" strokeWidth="2" />
              <circle cx="335" cy="290" r="2" fill="#fff3ce" data-tonearm-stylus />
              <path d="M351 269L366 256" stroke="#dce2dc" strokeWidth="4" strokeLinecap="round" />
            </g>
          </g>
        </svg>
        <div key={`carrier-${active.slug}`} className="mechanical-jukebox__carrier"><span className="mechanical-jukebox__carrier-rail" /><span className="mechanical-jukebox__carrier-neck" /><span className="mechanical-jukebox__claw" /></div>
        <div key={`record-${active.slug}`} className="mechanical-jukebox__record" data-record-transport data-record-slug={active.slug}
          onAnimationEnd={event => {
            if (event.target !== event.currentTarget || !event.animationName.startsWith("studio-record-transfer")) return;
            const slug = event.currentTarget.dataset.recordSlug;
            if (slug === playerStateRef.current.selectedSlug) setSeatedRecordSlug(slug);
          }}>
          <div className="mechanical-jukebox__record-spin"><span className="mechanical-jukebox__grooves" /><span className="mechanical-jukebox__record-label"><ProjectArtwork project={active} sizes="110px" /></span><span className="mechanical-jukebox__spindle" /></div>
        </div>
        <span className="mechanical-jukebox__power"><i />{t(playing ? "En lecture" : playbackLoading ? "Chargement…" : "Extrait sélectionné")}</span>
        <span className="mechanical-jukebox__screw mechanical-jukebox__screw--one" /><span className="mechanical-jukebox__screw mechanical-jukebox__screw--two" />
        <span className="mechanical-jukebox__screw mechanical-jukebox__screw--three" /><span className="mechanical-jukebox__screw mechanical-jukebox__screw--four" />
      </div>
      {visibleProjects.length > 1 ? <button className="home-jukebox__arrow home-jukebox__arrow--previous" type="button" onClick={() => selectVisible(currentVisibleIndex - 1)} disabled={currentVisibleIndex === 0} aria-label={t("Projet précédent")}>{leftArrow}</button> : null}
      <ul className="home-jukebox__rail" ref={railRef} aria-label={t("Projets à parcourir")}>
        {visibleProjects.map((project, index) => {
          const distance = index - currentVisibleIndex;
          // Only three actual covers are mounted. Native responsive images stay
          // crisp without a permanent gallery canvas, textures, or render loop.
          if (Math.abs(distance) > 1) return null;
          const position = distance === 0 ? "is-active" : distance === -1 ? "is-previous" : distance === 1 ? "is-next" : distance === -2 ? "is-far-previous" : distance === 2 ? "is-far-next" : distance < 0 ? "is-hidden-before" : "is-hidden-after";
          const preloadCover = Math.abs(distance) <= 1;
          const outsideScene = Math.abs(distance) > 2;
          const globalIndex = globalIndexBySlug.get(project.slug) ?? 0;
          const artwork = <ProjectArtwork project={project} priority={eager && preloadCover} sizes="(max-width: 600px) 58vw, (max-width: 1200px) 24vw, (max-width: 1799px) 420px, 512px" className="discography-card__artwork" />;

          return <li className={`home-jukebox__item ${position}`} data-project-index={globalIndex} aria-hidden={outsideScene || undefined} tabIndex={distance === 0 ? -1 : undefined} key={project.slug}>
            <article className="discography-card" data-active={distance === 0 || undefined} aria-current={distance === 0 ? "true" : undefined}>
              <div className="discography-card__art">
                {artwork}
                {playingSlug === project.slug && project.audioPreview ? <>
                  <span className="discography-card__playing" aria-hidden="true">{t("En lecture")}</span>
                  <span className="home-jukebox__progress" style={{ transform: `scaleX(${progress})` }} aria-hidden="true" />
                </> : null}
              </div>
              <div className="discography-card__body">
                <p>{projectMeta(project, t)}</p>
                <h3><OriginalName>{project.title}</OriginalName></h3>
                {distance === 0 ? <Link className="discography-card__link" href={`/album/${project.slug}`} aria-label={`${t("Entrer dans le projet")} ${project.title}`} data-active-control="true">{t("Entrer")} <span aria-hidden="true"><UiIcon name="arrow-right" /></span></Link> : null}
              </div>
              {distance !== 0 ? <button
                className="discography-card__select-hit"
                type="button"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onClick={() => handleCoverClick(globalIndex)}
                aria-label={`${t("Afficher")} ${project.title}`}
                tabIndex={outsideScene ? -1 : 0}
              /> : null}
            </article>
          </li>;
        })}
      </ul>
      {visibleProjects.length > 1 ? <button className="home-jukebox__arrow home-jukebox__arrow--next" type="button" onClick={() => selectVisible(currentVisibleIndex + 1)} disabled={currentVisibleIndex === visibleProjects.length - 1} aria-label={t("Projet suivant")}>{rightArrow}</button> : null}
    <div className="discography-jukebox__player-context" data-player-context>
      <div className="discography-jukebox__player-copy">
        <span>{t(playing ? "En lecture" : "Extrait sélectionné")}</span>
        <Link className="mechanical-jukebox__project-link" href={`/album/${playerProject.slug}`} aria-label={`${t("Entrer dans le projet")} ${playerProject.title}`}><strong><OriginalName>{playerProject.title}</OriginalName></strong><UiIcon name="arrow-right" /></Link>
        <small>{playerProject.audioPreview ? `${t("Extrait")} · ${previewDuration(playerProject.audioPreview.durationMs)}` : t(playerProject.membersPreviewOnly ? "Extrait réservé aux membres" : "Aucun extrait disponible")}</small>
        {!playerProject.audioPreview && playerProject.membersPreviewOnly ? <Link className="text-link" href={`/avant-premieres#${playerProject.slug}`}>{t("Écouter les extraits réservés aux membres")}</Link> : null}
      </div>
      {playingProject && playingProject.slug !== active.slug ? <p className="discography-jukebox__selected-context">{t("Sélection affichée")} <strong><OriginalName>{active.title}</OriginalName></strong></p> : null}
      <button
        type="button"
        className="discography-jukebox__player-toggle"
        aria-label={`${t(playing || playbackLoading ? "Mettre en pause l’extrait de" : selectedHasEnded ? "Relire l’extrait de" : "Lire l’extrait de")} ${playerProject.title}`}
        aria-busy={playbackLoading}
        disabled={!playerProject.audioPreview}
        onClick={() => { if (playing) pauseCurrent(); else void togglePlay(); }}
      >
        <StudioVinylControl state={playbackState} />
      </button>
      <span className="discography-jukebox__player-progress" aria-hidden="true"><span style={{ transform: `scaleX(${progress})` }} /></span>
    </div>
    </div>
    <p className="discography-jukebox__continuity"><T text={audioUnlocked
      ? "Écoute continue activée · changez d’album pour découvrir un nouvel extrait."
      : "Lancez un extrait pour activer l’écoute au changement d’album."}/></p>
    {playbackFailure ? <p className="discography-jukebox__playback-message" role="status"><T text={playbackFailure === "blocked"
      ? "Votre navigateur demande une action : touchez le bouton de lecture pour écouter cet extrait."
      : "Impossible de lire cet extrait. Vous pouvez réessayer avec le bouton de lecture."}/></p> : null}
    {playingProject && playingProject.slug !== active.slug && active.audioPreview ? <button className="discography-jukebox__play-selection" type="button" onClick={() => void togglePlay()}>
      {t("Lire la sélection")} : <OriginalName>{active.title}</OriginalName> <UiIcon name="play" />
    </button> : null}
    <audio
      ref={audioRef}
      preload="metadata"
      controlsList="nodownload noplaybackrate"
      onPlay={(event) => {
        const sourceSlug = loadedSlugRef.current;
        const pendingPlay = pendingPlayRef.current;
        const expectedPlay = pendingPlay?.requestId === playRequestRef.current && pendingPlay.slug === sourceSlug;
        const settledPlay = playerStateRef.current.playingSlug === sourceSlug;
        if (!sourceSlug || event.currentTarget.paused || (!expectedPlay && !settledPlay)) {
          if (!event.currentTarget.paused) event.currentTarget.pause();
          return;
        }
        announceMediaPlayback({ ownerId: playerId, kind: "audio" });
        setEnded(false);
      }}
      onPause={(event) => {
        const sourceSlug = loadedSlugRef.current;
        if (!sourceSlug || !event.currentTarget.paused) return;
        // A system/media-control pause is a real request to stop continuous
        // listening. Switching sources has already cleared playingSlug, and
        // the natural end of a preview must not disable album navigation.
        if (!event.currentTarget.ended && !pendingPlayRef.current && playerStateRef.current.playingSlug === sourceSlug) {
          continuousListeningRef.current = false;
          setAudioUnlocked(false);
          setPlaybackLoading(false);
        }
        transitionPlayerState({ type: "pause", slug: sourceSlug });
      }}
      onEnded={(event) => {
        const sourceSlug = loadedSlugRef.current;
        if (!sourceSlug || !event.currentTarget.ended) return;
        transitionPlayerState({ type: "pause", slug: sourceSlug });
        setProgress(0);
        setEnded(playerStateRef.current.selectedSlug === sourceSlug);
      }}
      onError={(event) => {
        if (!event.currentTarget.error || !event.currentTarget.getAttribute("src")) return;
        pauseCurrent(false);
        setPlaybackFailure("unavailable");
      }}
      onTimeUpdate={(event) => {
        const metadataSlug = jukeboxPlayerMetadataSlug(playerStateRef.current);
        if (loadedSlugRef.current !== metadataSlug) return;
        setProgress(event.currentTarget.duration ? event.currentTarget.currentTime / event.currentTarget.duration : 0);
      }}
    />
  </section>;
}
