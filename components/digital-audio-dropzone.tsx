"use client";
import { useId, useRef, useState } from "react";
import styles from "./digital-audio-dropzone.module.css";

type Props = { onFiles: (files: File[]) => void; disabled?: boolean; compact?: boolean; minimal?: boolean; heading?: string; description?: string; multiple?: boolean };
export function DigitalAudioDropzone({ onFiles, disabled = false, compact = false, minimal = false, heading = "Vos fichiers audio", description = "La sélection reste sur cet appareil. Aucun envoi à ce stade.", multiple = true }: Props) {
  const id = useId(), depth = useRef(0), [dragging, setDragging] = useState(false);
  return <section className={`${styles.root} ${compact ? styles.compact : ""} ${dragging && !disabled ? styles.dragging : ""} ${minimal ? styles.minimal : ""}`} aria-labelledby={minimal ? undefined : `${id}-heading`} aria-label={minimal ? heading : undefined} data-disabled={disabled}
    onDragEnter={event => { event.preventDefault(); event.stopPropagation(); if (!disabled) { depth.current += 1; setDragging(true); } }}
    onDragOver={event => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = disabled ? "none" : "copy"; }}
    onDragLeave={event => { event.preventDefault(); event.stopPropagation(); depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false); }}
    onDrop={event => { event.preventDefault(); event.stopPropagation(); depth.current = 0; setDragging(false); const files = Array.from(event.dataTransfer.files); if (!disabled && files.length) onFiles(files); }}>
    {!minimal && <h3 id={`${id}-heading`}>{heading}</h3>}
    <label className={styles.pick} htmlFor={id}>
      {!minimal && <><span className={styles.icon} aria-hidden="true">↑</span><strong>{multiple ? "Glissez vos fichiers WAV ou MP3 ici" : "Glissez votre fichier WAV ou MP3 ici"}</strong></>}
      <span className={styles.choose}>{minimal ? multiple ? "Choisir des fichiers" : "Choisir un fichier" : multiple ? "ou choisir des fichiers" : "ou choisir un fichier"}</span>
      <input id={id} className={styles.input} type="file" multiple={multiple} accept=".wav,.mp3,audio/wav,audio/x-wav,audio/mpeg" disabled={disabled} aria-label={minimal ? `${multiple ? "Choisir des fichiers" : "Choisir un fichier"} — ${heading}` : multiple ? undefined : `Fichier audio — ${heading}`} aria-describedby={minimal ? undefined : `${id}-help`} onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ""; if (!disabled && files.length) onFiles(files); }} />
    </label>
    {!minimal && <p id={`${id}-help`} className={styles.help}>{description}</p>}
  </section>;
}
