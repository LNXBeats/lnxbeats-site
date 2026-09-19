"use client";

import Image from "next/image";
import Link from "next/link";
import {
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";

import {
  initialCreationMediaPlayerState,
  reduceCreationMediaPlayerState,
  type CreationMediaPlayerAction,
} from "@/lib/creations/media-player";
import {
  creationArtwork,
  creationPresentationMedia,
  creationVideoOrientation,
  resolvedCreationPrimaryMedia,
  type CreationMediaKind,
  type CreationPrimaryMedia,
  type PublicCreation,
} from "@/lib/creations/types";
import { announceMediaPlayback, listenForOtherMediaPlayback } from "@/lib/media/playback-coordinator";

type CreationMediaStageProps = {
  creations: readonly PublicCreation[];
  initialSlug?: string;
  showRail?: boolean;
  showGrid?: boolean;
  headingLevel?: "h1" | "h2";
};

type MediaElement = HTMLAudioElement | HTMLVideoElement;
type CreationFilter = "all" | "music" | "video" | "collaboration";

const creationFilters: readonly Readonly<{ id: CreationFilter; label: string }>[] = [
  { id: "all", label: "Tous" },
  { id: "music", label: "Musique" },
  { id: "video", label: "Vidéos" },
  { id: "collaboration", label: "Collaborations" },
];

function isCollaboration(creation: PublicCreation) {
  return Boolean(creation.collaborator?.trim())
    || creation.category?.toLocaleLowerCase("fr").includes("collaboration") === true;
}

function matchesCreationFilter(creation: PublicCreation, filter: CreationFilter) {
  if (filter === "music") return Boolean(creation.audio);
  if (filter === "video") return Boolean(creation.video);
  if (filter === "collaboration") return isCollaboration(creation);
  return true;
}

function timeLabel(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function mediaKey(slug: string, kind: CreationMediaKind) {
  return `${slug}:${kind}`;
}

function finiteDuration(seconds: number, fallback = 0) {
  if (Number.isFinite(seconds) && seconds > 0) return seconds;
  return Number.isFinite(fallback) && fallback > 0 ? fallback : 0;
}

function CreationArtwork({
  creation,
  priority = false,
  className = "",
}: {
  creation: PublicCreation;
  priority?: boolean;
  className?: string;
}) {
  const artwork = creationArtwork(creation);
  return (
    <div className={`creation-artwork ${className}`} data-has-artwork={Boolean(artwork)}>
      {artwork ? (
        <Image
          src={artwork.url}
          alt={artwork.alt || `Visuel de ${creation.title}`}
          fill
          unoptimized
          priority={priority}
          loading={priority ? "eager" : "lazy"}
          sizes="(max-width: 820px) 92vw, (max-width: 1440px) 58vw, 900px"
        />
      ) : (
        <div className="creation-artwork__fallback" aria-label={`Visuel de ${creation.title}`}>
          <span>LNX</span>
          <strong>{creation.title}</strong>
        </div>
      )}
    </div>
  );
}

function mediaLabel(kind: CreationPrimaryMedia) {
  if (kind === "audio") return "Écouter l’audio";
  if (kind === "video") return "Voir la vidéo";
  return "Voir le visuel";
}

function selectionFromAction(
  current: ReturnType<typeof initialCreationMediaPlayerState>,
  action: CreationMediaPlayerAction,
) {
  return reduceCreationMediaPlayerState(current, action);
}

export function CreationMediaStage({
  creations,
  initialSlug,
  showRail = true,
  showGrid = true,
  headingLevel = "h2",
}: CreationMediaStageProps) {
  const safeInitialIndex = Math.max(0, creations.findIndex((creation) => creation.slug === initialSlug));
  const initialCreation = creations[safeInitialIndex] ?? creations[0];
  const initialMode = initialCreation ? resolvedCreationPrimaryMedia(initialCreation) : "cover";
  const [state, dispatch] = useReducer(
    selectionFromAction,
    initialCreation
      ? initialCreationMediaPlayerState(initialCreation.slug, initialMode)
      : initialCreationMediaPlayerState("", "cover"),
  );
  const stateRef = useRef(state);
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef<Record<CreationMediaKind, string | null>>({ audio: null, video: null });
  const positionsRef = useRef(new Map<string, number>());
  const playRequestRef = useRef(0);
  const [videoMounted, setVideoMounted] = useState(false);
  const [loadedMedia, setLoadedMedia] = useState<Record<CreationMediaKind, string | null>>({
    audio: null,
    video: null,
  });
  const [progress, setProgress] = useState({ key: "", current: 0, duration: 0 });
  const [failedMedia, setFailedMedia] = useState<string | null>(null);
  const [creationFilter, setCreationFilter] = useState<CreationFilter>("all");
  const componentId = useId();
  const ownerId = `creation-media-${componentId}`;
  const headingId = `creation-heading-${componentId}`;

  const selected = creations.find((creation) => creation.slug === state.selectedCreationSlug) ?? initialCreation;
  const activeCreation = state.activeMedia
    ? creations.find((creation) => creation.slug === state.activeMedia?.creationSlug) ?? null
    : null;
  const selectedMediaKinds = selected ? creationPresentationMedia(selected) : [];
  const filteredCreations = useMemo(
    () => creations.filter((creation) => matchesCreationFilter(creation, creationFilter)),
    [creationFilter, creations],
  );
  const filterCounts = useMemo(() => ({
    all: creations.length,
    music: creations.filter((creation) => matchesCreationFilter(creation, "music")).length,
    video: creations.filter((creation) => matchesCreationFilter(creation, "video")).length,
    collaboration: creations.filter((creation) => matchesCreationFilter(creation, "collaboration")).length,
  }), [creations]);

  const transition = useCallback((action: CreationMediaPlayerAction) => {
    stateRef.current = reduceCreationMediaPlayerState(stateRef.current, action);
    dispatch(action);
  }, []);

  const elementFor = useCallback((kind: CreationMediaKind): MediaElement | null => (
    kind === "audio" ? audioRef.current : videoRef.current
  ), []);

  const creationForLoadedMedia = useCallback((kind: CreationMediaKind) => {
    const slug = loadedRef.current[kind];
    return slug ? creations.find((creation) => creation.slug === slug) ?? null : null;
  }, [creations]);

  const rememberPosition = useCallback((kind: CreationMediaKind) => {
    const element = elementFor(kind);
    const slug = loadedRef.current[kind];
    if (element && slug && Number.isFinite(element.currentTime)) {
      positionsRef.current.set(mediaKey(slug, kind), element.currentTime);
    }
  }, [elementFor]);

  const pauseKind = useCallback((kind: CreationMediaKind) => {
    const element = elementFor(kind);
    if (!element) return;
    rememberPosition(kind);
    if (!element.paused) element.pause();
  }, [elementFor, rememberPosition]);

  const sourceFor = useCallback((creation: PublicCreation, kind: CreationMediaKind) => (
    kind === "audio" ? creation.audio?.url ?? null : creation.video?.url ?? null
  ), []);

  const load = useCallback((kind: CreationMediaKind, creation: PublicCreation) => {
    const element = elementFor(kind);
    const source = sourceFor(creation, kind);
    if (!element || !source) return false;
    if (loadedRef.current[kind] === creation.slug && element.getAttribute("src") === source) return true;
    const previouslyLoadedSlug = loadedRef.current[kind];
    rememberPosition(kind);
    if (!element.paused) element.pause();
    if (previouslyLoadedSlug) transition({ type: "pause", slug: previouslyLoadedSlug, kind });
    playRequestRef.current += 1;
    loadedRef.current[kind] = creation.slug;
    setLoadedMedia((current) => ({ ...current, [kind]: creation.slug }));
    element.src = source;
    element.load();
    const durationMs = kind === "audio" ? creation.audio?.durationMs : creation.video?.durationMs;
    setProgress({
      key: mediaKey(creation.slug, kind),
      current: 0,
      duration: durationMs ? durationMs / 1_000 : 0,
    });
    setFailedMedia(null);
    return true;
  }, [elementFor, rememberPosition, sourceFor, transition]);

  const play = useCallback(async (kind: CreationMediaKind, creation: PublicCreation) => {
    if (!sourceFor(creation, kind)) return;
    transition({ type: "select-media", media: kind });
    let element = elementFor(kind);
    if (kind === "video" && !element) {
      // Keep the first play() inside the trusted click for Safari/iOS while still
      // leaving the video element out of the initial page payload.
      flushSync(() => setVideoMounted(true));
      element = videoRef.current;
    }
    if (!element) return;
    const active = stateRef.current.activeMedia;
    if (active?.creationSlug === creation.slug && active.kind === kind && !element.paused) {
      pauseKind(kind);
      return;
    }
    pauseKind(kind === "audio" ? "video" : "audio");
    if (!load(kind, creation)) return;
    const requestId = ++playRequestRef.current;
    try {
      await element.play();
      if (requestId !== playRequestRef.current || loadedRef.current[kind] !== creation.slug || element.paused) return;
      transition({ type: "play", slug: creation.slug, kind });
    } catch {
      if (requestId === playRequestRef.current) setFailedMedia(mediaKey(creation.slug, kind));
    }
  }, [elementFor, load, pauseKind, sourceFor, transition]);

  const selectCreation = useCallback((creation: PublicCreation) => {
    const primaryMedia = resolvedCreationPrimaryMedia(creation);
    transition({
      type: "select-creation",
      slug: creation.slug,
      primaryMedia,
    });
    if (primaryMedia === "audio") {
      const key = mediaKey(creation.slug, "audio");
      setProgress({
        key,
        current: positionsRef.current.get(key) ?? 0,
        duration: (creation.audio?.durationMs ?? 0) / 1_000,
      });
    }
  }, [transition]);

  const selectMedia = useCallback((media: CreationPrimaryMedia, creation: PublicCreation) => {
    transition({ type: "select-media", media });
    if (media === "audio") {
      const key = mediaKey(creation.slug, "audio");
      setProgress({
        key,
        current: positionsRef.current.get(key) ?? 0,
        duration: (creation.audio?.durationMs ?? 0) / 1_000,
      });
    }
  }, [transition]);

  const restoreRememberedPosition = useCallback((kind: CreationMediaKind, element: MediaElement) => {
    const slug = loadedRef.current[kind];
    if (!slug) return;
    const remembered = positionsRef.current.get(mediaKey(slug, kind)) ?? 0;
    const fallbackMs = kind === "audio"
      ? creationForLoadedMedia(kind)?.audio?.durationMs
      : creationForLoadedMedia(kind)?.video?.durationMs;
    const duration = finiteDuration(element.duration, (fallbackMs ?? 0) / 1_000);
    if (remembered > 0 && duration > 0) {
      element.currentTime = Math.min(remembered, Math.max(0, duration - 0.05));
    }
    setProgress({ key: mediaKey(slug, kind), current: element.currentTime, duration });
  }, [creationForLoadedMedia]);

  useEffect(() => { stateRef.current = state; }, [state]);

  useEffect(() => listenForOtherMediaPlayback(ownerId, () => {
    playRequestRef.current += 1;
    pauseKind("audio");
    pauseKind("video");
  }), [ownerId, pauseKind]);

  useEffect(() => () => {
    playRequestRef.current += 1;
    audioRef.current?.pause();
    videoRef.current?.pause();
  }, []);

  useEffect(() => {
    if (!selected || !showRail) return;
    const rail = railRef.current;
    const activeButton = rail?.querySelector<HTMLElement>(`[data-creation-slug="${CSS.escape(selected.slug)}"]`);
    if (!rail || !activeButton) return;
    const left = activeButton.offsetLeft - (rail.clientWidth - activeButton.offsetWidth) / 2;
    rail.scrollTo({
      left: Math.max(0, left),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }, [selected, showRail]);

  const mediaStateLabel = useMemo(() => {
    if (!state.activeMedia || !activeCreation) return "Aucun média en lecture";
    return `${state.activeMedia.kind === "video" ? "Vidéo" : "Audio"} en lecture · ${activeCreation.title}`;
  }, [activeCreation, state.activeMedia]);

  if (!selected) return null;

  const Heading = headingLevel;
  const artwork = creationArtwork(selected);
  const videoVisible = state.selectedMedia === "video" && loadedMedia.video === selected.slug;
  const videoOrientation = creationVideoOrientation(selected.video);
  const selectedAudioActive = state.activeMedia?.creationSlug === selected.slug && state.activeMedia.kind === "audio";
  const selectedVideoActive = state.activeMedia?.creationSlug === selected.slug && state.activeMedia.kind === "video";
  const selectedAudioKey = mediaKey(selected.slug, "audio");
  const visibleProgress = progress.key === selectedAudioKey ? progress : {
    key: selectedAudioKey,
    current: 0,
    duration: (selected.audio?.durationMs ?? 0) / 1_000,
  };

  function updateAudioPosition(event: ChangeEvent<HTMLInputElement>) {
    const next = Number(event.currentTarget.value);
    if (!Number.isFinite(next) || loadedRef.current.audio !== selected.slug || !audioRef.current) return;
    audioRef.current.currentTime = next;
    positionsRef.current.set(selectedAudioKey, next);
    setProgress((current) => ({ ...current, current: next }));
  }

  function railKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    const filteredSelectedIndex = Math.max(0, filteredCreations.findIndex((creation) => creation.slug === selected.slug));
    const next = Math.min(filteredCreations.length - 1, Math.max(0, filteredSelectedIndex + direction));
    const target = filteredCreations[next];
    if (!target) return;
    selectCreation(target);
    railRef.current?.querySelector<HTMLButtonElement>(`[data-creation-slug="${CSS.escape(target.slug)}"]`)?.focus();
  }

  return (
    <section className="creation-experience" aria-labelledby={headingId} data-selected-creation={selected.slug} data-active-media={state.activeMedia ? `${state.activeMedia.creationSlug}:${state.activeMedia.kind}` : ""}>
      <div className="creation-stage" data-primary-media={state.selectedMedia}>
        {artwork ? <div className="creation-stage__ambient" aria-hidden="true"><Image src={artwork.url} alt="" fill unoptimized sizes="1px" /></div> : null}
        <div className="creation-stage__media">
          <div
            className="creation-stage__frame"
            data-video-visible={videoVisible || undefined}
            data-video-orientation={videoOrientation}
          >
            {!videoVisible ? <CreationArtwork creation={selected} priority /> : null}
            {videoMounted ? (
              <video
                ref={videoRef}
                className={`creation-stage__video${videoVisible ? " is-visible" : ""}`}
                controls
                playsInline
                preload="none"
                poster={selected.poster?.url ?? selected.cover?.url ?? undefined}
                tabIndex={videoVisible ? 0 : -1}
                aria-hidden={!videoVisible}
                aria-label={`Vidéo de ${loadedMedia.video ? creations.find((creation) => creation.slug === loadedMedia.video)?.title ?? selected.title : selected.title}`}
                onLoadedMetadata={(event) => restoreRememberedPosition("video", event.currentTarget)}
                onPlay={(event) => {
                  const loaded = creationForLoadedMedia("video");
                  if (!loaded || event.currentTarget.paused) return;
                  pauseKind("audio");
                  announceMediaPlayback({ ownerId, kind: "video" });
                  transition({ type: "play", slug: loaded.slug, kind: "video" });
                }}
                onPause={() => {
                  rememberPosition("video");
                  const loaded = creationForLoadedMedia("video");
                  if (loaded) transition({ type: "pause", slug: loaded.slug, kind: "video" });
                }}
                onEnded={(event) => {
                  const loaded = creationForLoadedMedia("video");
                  if (loaded) {
                    positionsRef.current.set(mediaKey(loaded.slug, "video"), 0);
                    transition({ type: "pause", slug: loaded.slug, kind: "video" });
                  }
                  event.currentTarget.currentTime = 0;
                }}
                onError={() => {
                  const slug = loadedRef.current.video;
                  if (slug) setFailedMedia(mediaKey(slug, "video"));
                }}
              >
                Votre navigateur ne peut pas lire cette vidéo MP4.
              </video>
            ) : null}
            {state.selectedMedia === "video" && selected.video && !videoVisible ? (
              <button
                className="creation-stage__launch"
                type="button"
                aria-label={`Lire la vidéo de ${selected.title}`}
                onClick={() => void play("video", selected)}
              >
                <span aria-hidden="true">▶</span>
                Lire la vidéo
              </button>
            ) : null}
            {state.selectedMedia === "audio" && selected.audio ? (
              <div className="creation-stage__audio-overlay">
                <button type="button" onClick={() => void play("audio", selected)} aria-label={selectedAudioActive ? `Mettre en pause ${selected.title}` : `Lire ${selected.title}`}>
                  <span aria-hidden="true">{selectedAudioActive ? "Ⅱ" : "▶"}</span>
                  {selectedAudioActive ? "Pause" : "Écouter"}
                </button>
                <div>
                  <strong>{selected.title}</strong>
                  <span>{selected.collaborator ? `avec ${selected.collaborator}` : "Création LNX Beats"}</span>
                </div>
              </div>
            ) : null}
          </div>

          {selectedMediaKinds.length > 1 ? (
            <div className="creation-stage__media-tabs" role="group" aria-label={`Médias de ${selected.title}`}>
              {selectedMediaKinds.map((kind) => (
                <button
                  type="button"
                  key={kind}
                  aria-pressed={state.selectedMedia === kind}
                  onClick={() => selectMedia(kind, selected)}
                >
                  {mediaLabel(kind)}
                </button>
              ))}
            </div>
          ) : null}

          {state.selectedMedia === "audio" && selected.audio ? (
            <div className="creation-stage__audio-progress">
              <label>
                <span className="visually-hidden">Position dans l’audio de {selected.title}</span>
                <input
                  type="range"
                  min="0"
                  max={Math.max(visibleProgress.duration, 0)}
                  step="0.1"
                  value={Math.min(visibleProgress.current, Math.max(visibleProgress.duration, 0))}
                  disabled={loadedMedia.audio !== selected.slug || !visibleProgress.duration}
                  onChange={updateAudioPosition}
                />
              </label>
              <output>{timeLabel(visibleProgress.current)} / {timeLabel(visibleProgress.duration)}</output>
            </div>
          ) : null}
          {(state.selectedMedia === "audio" || state.selectedMedia === "video")
            && failedMedia === mediaKey(selected.slug, state.selectedMedia)
            ? <p className="creation-stage__error" role="status">Ce média ne peut pas être lu pour le moment.</p>
            : null}
        </div>

        <div className="creation-stage__copy">
          <p className="creation-stage__eyebrow">{selected.category || "Création originale"}</p>
          <Heading id={headingId}>{selected.title}</Heading>
          {selected.collaborator ? <p className="creation-stage__collaborator">Avec <strong>{selected.collaborator}</strong></p> : null}
          <p className="creation-stage__summary">{selected.summary}</p>
          <p className="creation-stage__playing-state" aria-live="polite">
            <span aria-hidden="true" data-playing={Boolean(state.activeMedia)} />
            {mediaStateLabel}
          </p>
          {activeCreation && activeCreation.slug !== selected.slug ? (
            <p className="creation-stage__selection-note">Vous regardez <strong>{selected.title}</strong> pendant que <strong>{activeCreation.title}</strong> reste en lecture.</p>
          ) : null}
          {showGrid ? (
            <div className="creation-stage__actions">
              {selected.audio ? <button type="button" data-active={selectedAudioActive || undefined} onClick={() => void play("audio", selected)}>{selectedAudioActive ? "Mettre en pause" : "Écouter l’audio"}</button> : null}
              {selected.video ? <button type="button" data-active={selectedVideoActive || undefined} onClick={() => void play("video", selected)}>{selectedVideoActive ? "Mettre en pause" : "Voir la vidéo"}</button> : null}
              <Link href={`/creations/${selected.slug}`}>Découvrir la création <span aria-hidden="true">→</span></Link>
            </div>
          ) : null}
        </div>
      </div>

      <audio
        ref={audioRef}
        preload="none"
        onLoadedMetadata={(event) => restoreRememberedPosition("audio", event.currentTarget)}
        onPlay={(event) => {
          const loaded = creationForLoadedMedia("audio");
          if (!loaded || event.currentTarget.paused) return;
          pauseKind("video");
          announceMediaPlayback({ ownerId, kind: "audio" });
          transition({ type: "play", slug: loaded.slug, kind: "audio" });
        }}
        onPause={() => {
          rememberPosition("audio");
          const loaded = creationForLoadedMedia("audio");
          if (loaded) transition({ type: "pause", slug: loaded.slug, kind: "audio" });
        }}
        onTimeUpdate={(event) => {
          const slug = loadedRef.current.audio;
          if (!slug) return;
          const key = mediaKey(slug, "audio");
          positionsRef.current.set(key, event.currentTarget.currentTime);
          setProgress({
            key,
            current: event.currentTarget.currentTime,
            duration: finiteDuration(event.currentTarget.duration, (creationForLoadedMedia("audio")?.audio?.durationMs ?? 0) / 1_000),
          });
        }}
        onEnded={(event) => {
          const loaded = creationForLoadedMedia("audio");
          if (loaded) {
            positionsRef.current.set(mediaKey(loaded.slug, "audio"), 0);
            transition({ type: "pause", slug: loaded.slug, kind: "audio" });
          }
          event.currentTarget.currentTime = 0;
        }}
        onError={() => {
          const slug = loadedRef.current.audio;
          if (slug) setFailedMedia(mediaKey(slug, "audio"));
        }}
      />

      {showGrid ? (
        <div className="creation-filters" role="group" aria-label="Filtrer les créations">
          {creationFilters.map((filter) => (
            <button
              type="button"
              key={filter.id}
              aria-pressed={creationFilter === filter.id}
              onClick={() => {
                setCreationFilter(filter.id);
                const next = creations.find((creation) => matchesCreationFilter(creation, filter.id));
                if (next && !matchesCreationFilter(selected, filter.id)) selectCreation(next);
              }}
            >
              <span>{filter.label}</span>
              <small aria-label={`${filterCounts[filter.id]} créations`}>{filterCounts[filter.id]}</small>
            </button>
          ))}
        </div>
      ) : null}

      {showRail && filteredCreations.length > 1 ? (
        <div className="creation-rail" ref={railRef} role="group" aria-label="Parcourir les créations" onKeyDown={railKeyboard}>
          {filteredCreations.map((creation) => {
            const itemArtwork = creationArtwork(creation);
            return (
              <button
                type="button"
                key={creation.slug}
                data-creation-slug={creation.slug}
                aria-pressed={creation.slug === selected.slug}
                onClick={() => selectCreation(creation)}
              >
                <span className="creation-rail__art">
                  {itemArtwork ? <Image src={itemArtwork.url} alt="" fill unoptimized sizes="160px" /> : <span>LNX</span>}
                </span>
                <span className="creation-rail__copy"><strong>{creation.title}</strong><small>{creation.category || "Création"}</small></span>
                <span className="creation-rail__media" aria-label={[creation.audio ? "audio" : null, creation.video ? "vidéo" : null].filter(Boolean).join(" et ")}>{creation.audio ? "♪" : ""}{creation.video ? "▶" : ""}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {showGrid ? (
        <div className="creation-catalogue">
          <div className="creation-catalogue__heading"><p>Le répertoire</p><h2>Toutes les créations.</h2></div>
          {filteredCreations.length ? <div className="creation-catalogue__grid">
            {filteredCreations.map((creation) => (
              <Link href={`/creations/${creation.slug}`} key={creation.slug} className="creation-card">
                <CreationArtwork creation={creation} />
                <span className="creation-card__body">
                  <small>{creation.category || "Création"}{creation.collaborator ? ` · avec ${creation.collaborator}` : ""}</small>
                  <strong>{creation.title}</strong>
                  <span>{creation.audio ? "Audio" : ""}{creation.audio && creation.video ? " + " : ""}{creation.video ? "Vidéo" : ""}</span>
                </span>
              </Link>
            ))}
          </div> : (
            <p className="creation-catalogue__empty" role="status">Aucune création ne correspond à ce filtre pour le moment.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
