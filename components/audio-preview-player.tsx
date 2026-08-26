"use client";

import { useEffect, useId, useRef, useState } from "react";
import { StudioVinylControl, type StudioVinylControlState } from "@/components/studio-vinyl-control";

const playbackEvent = "lnx-audio-preview-play";

function timeLabel(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const rounded = Math.floor(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

export function AudioPreviewPlayer({
  src,
  title,
  durationMs,
  compact = false,
  onTimeUpdate,
  onDuration,
}: {
  src: string;
  title: string;
  durationMs?: number | null;
  compact?: boolean;
  onTimeUpdate?: (timeSeconds: number) => void;
  onDuration?: (durationSeconds: number) => void;
}) {
  const reactId = useId();
  const playerId = `audio-${reactId}`;
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ended, setEnded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState((durationMs ?? 0) / 1_000);

  useEffect(() => {
    const stopOtherPlayer = (event: Event) => {
      if (!(event instanceof CustomEvent) || event.detail === playerId) return;
      audioRef.current?.pause();
    };
    window.addEventListener(playbackEvent, stopOtherPlayer);
    return () => window.removeEventListener(playbackEvent, stopOtherPlayer);
  }, [playerId]);

  async function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    setFailed(false);
    if (!audio.paused) {
      audio.pause();
      return;
    }
    setLoading(true);
    try { await audio.play(); }
    catch { setFailed(true); setPlaying(false); }
    finally { setLoading(false); }
  }

  return (
    <div className={`audio-preview-player${compact ? " audio-preview-player--compact" : ""}`} data-audio-player={title}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        controlsList="nodownload noplaybackrate"
        onPlay={() => {
          setPlaying(true);
          setEnded(false);
          window.dispatchEvent(new CustomEvent(playbackEvent, { detail: playerId }));
        }}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(event) => {
          setCurrentTime(event.currentTarget.currentTime);
          onTimeUpdate?.(event.currentTarget.currentTime);
        }}
        onLoadedMetadata={(event) => {
          if (Number.isFinite(event.currentTarget.duration)) {
            setDuration(event.currentTarget.duration);
            onDuration?.(event.currentTarget.duration);
          }
          setFailed(false);
        }}
        onEnded={(event) => {
          event.currentTarget.currentTime = 0;
          setCurrentTime(0);
          setPlaying(false);
          setEnded(true);
        }}
        onError={() => { setFailed(true); setLoading(false); setPlaying(false); }}
      />
      <button
        className="audio-preview-player__toggle"
        type="button"
        aria-label={playing
          ? `Mettre en pause l’extrait de ${title}`
          : ended
            ? `Relire l’extrait de ${title}`
            : `Lire l’extrait de ${title}`}
        onClick={() => void toggle()}
        disabled={loading}
      >
        <StudioVinylControl state={(loading ? "loading" : playing ? "pause" : ended ? "replay" : "play") satisfies StudioVinylControlState} />
      </button>
      <div className="audio-preview-player__body">
        <strong>{title}</strong>
        <span>Extrait audio · {timeLabel(duration)}</span>
        <label>
          <span className="sr-only">Position dans l’extrait de {title}</span>
          <input
            type="range"
            min="0"
            max={Math.max(duration, 0)}
            step="0.1"
            value={Math.min(currentTime, Math.max(duration, 0))}
            disabled={!duration || failed}
            onChange={(event) => {
              const next = Number(event.currentTarget.value);
              if (audioRef.current && Number.isFinite(next)) {
                audioRef.current.currentTime = next;
                setCurrentTime(next);
                setEnded(false);
              }
            }}
          />
        </label>
      </div>
      <output className="audio-preview-player__time" aria-live="off">{timeLabel(currentTime)} / {timeLabel(duration)}</output>
      {loading ? <span className="audio-preview-player__status">Chargement…</span> : null}
      {failed ? <span className="audio-preview-player__error" role="status">Impossible de lire cet extrait.</span> : null}
    </div>
  );
}
