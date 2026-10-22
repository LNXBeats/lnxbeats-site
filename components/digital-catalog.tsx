"use client";
import { T, useSiteLanguage } from "@/components/site-language";
import { OriginalName } from "@/components/original-name";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { StudioVinylControl } from "@/components/studio-vinyl-control";
import { announceMediaPlayback, listenForOtherMediaPlayback } from "@/lib/media/playback-coordinator";
import { digitalTimeLabel, isDigitalIntentionalPlaybackAbort } from "@/lib/digital/presentation";
import { CATALOG_PRIMARY_ARTIST } from "@/lib/catalog/artist-identity";
import { digitalFormatsLabel } from "@/lib/digital/format-presentation";
import type { DigitalAudioFormat } from "@/lib/digital/formats";
import styles from "./digital.module.css";
import { digitalUiIsLive, type DigitalUiMode } from "./digital-mode-copy";
export const DIGITAL_CART_KEY = "lnx:dcn:cart:v1";
export function readDigitalCart(): string[] { try { const v = JSON.parse(localStorage.getItem(DIGITAL_CART_KEY) ?? "[]"); return Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string"))].slice(0, 50) : []; } catch { return []; } }
export function writeDigitalCart(ids: string[]) { localStorage.setItem(DIGITAL_CART_KEY, JSON.stringify([...new Set(ids)])); window.dispatchEvent(new Event("dcn-cart")); }
export { digitalMoney } from "@/lib/digital/cart-presentation";
export type DigitalCompletionView = { basePriceCents:number; creditCents:number; creditedTrackCount?:number; priceCents?:number; blockedReason?:string|null };
export function AddDigitalOffer({ id, priceCents, label = "Ajouter au panier", title, owned = false, partiallyOwned = false, completion, formats }: { id: string; priceCents: number; label?: string; title?: string; owned?: boolean; partiallyOwned?: boolean; completion?:DigitalCompletionView|null; formats?: readonly DigitalAudioFormat[] }) {
  const { t, money, locale } = useSiteLanguage();
  const [added, setAdded] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState(false);
  useEffect(() => { const update = () => setAdded(readDigitalCart().includes(id)); update(); window.addEventListener("dcn-cart", update); window.addEventListener("storage", update); return () => { window.removeEventListener("dcn-cart", update); window.removeEventListener("storage", update); }; }, [id]);
  return <div className={styles.offerActions} lang={locale === "zh" ? "zh-Hans" : locale}>{formats ? <small className={styles.muted}>{t(digitalFormatsLabel(formats))}{formats.length === 1 && formats[0] === "MP3" ? <> · {t("Fichier source compressé. Aucun WAV ni amélioration de qualité inclus.")}</> : null}</small> : null}<strong className={styles.price}>{money(priceCents)}</strong>{owned || partiallyOwned&&!completion ? <Link className={styles.ownedLink} href="/compte/musique">{t(owned ? "Déjà dans votre musique" : "Titres déjà acquis — Ma musique")}</Link> : <button className={styles.button} type="button" aria-label={title ? `${t(added ? "Dans le panier" : label)} — ${title}` : undefined} disabled={added} onClick={() => { setError(false); try { writeDigitalCart([...readDigitalCart(), id]); setMessage(`${title ?? t("Votre sélection")} — ${t("Ajouté au panier")}`); } catch { setError(true); setMessage(t("Le navigateur n’a pas pu enregistrer le panier.")); } }}>{t(added ? "Dans le panier" : label)}</button>}<span className={error ? styles.playError : "sr-only"} role="status" aria-live="polite" lang={locale === "zh" ? "zh-Hans" : locale} translate="no">{message}</span></div>;
}
export type DigitalProjectView = {
  membersPreviewOnly?: boolean;
  album: { id: string; priceCents: number; version: number; trackCount: number; owned?: boolean; partiallyOwned?: boolean; formats?: readonly DigitalAudioFormat[]; completion?:DigitalCompletionView|null } | null;
  tracks: Array<{ id: string; title: string; position: number; publication: string; previewUrl: string | null; previewDurationMs: number | null; fullDurationMs?: number | null; owned?: boolean; offer: { id: string; priceCents: number; version: number; formats?: readonly DigitalAudioFormat[] } | null }>;
};
export function DigitalAlbumOffer({ album }: { album: DigitalProjectView["album"] }) {
  const { t, money } = useSiteLanguage();
  const completion=album?.completion&&!album.completion.blockedReason?album.completion:null;
  const payable=completion?.priceCents??album?.priceCents??0;
  return <div className={styles.albumOffer}>{album ? <><p className="eyebrow">{t("L’album numérique")}</p><strong>{album.trackCount} {t(album.trackCount === 1 ? "piste incluse" : "pistes incluses")}</strong>{completion?<div className={styles.completionSummary}><span>{t("Prix de l’album")} : {money(completion.basePriceCents)}</span><span>{t("Crédit des titres éligibles déjà payés")} : −{money(completion.creditCents)}</span><strong>{t("Reste à payer")} : {money(payable)}</strong></div>:null}<AddDigitalOffer {...album} completion={completion} priceCents={payable} label={completion?"Compléter l’album":"Ajouter l’album au panier"}/><p className={styles.muted}><T text={digitalFormatsLabel(album.formats) === "WAV + MP3" ? "WAV + MP3 inclus, téléchargements privés. Deux archives distinctes : ZIP WAV et ZIP MP3." : "Téléchargements privés dans les formats indiqués pour cette offre."}/></p>{album.partiallyOwned&&!completion ? <p className={styles.muted}><T text="Ce complément nécessite une revue : aucune somme incertaine n’est déduite automatiquement. Vos titres acquis restent accessibles."/> <Link href="/contact" className="text-link"><T text="Contacter LNX Beats pour examiner le complément"/></Link>.</p> : completion?<p className={styles.muted}><T text="Le crédit correspond aux titres individuels confirmés, après remboursements. Il est revérifié avant paiement ; les justificatifs antérieurs restent inchangés."/></p>:null}</> : <p className={styles.muted}><T text="Album indisponible à l’achat. Consultez les pistes ci-dessous."/></p>}</div>;
}
/** Uses the existing site-wide coordinator. Audio loads only after user play. */
function DigitalTrackRow({ track }: { track: DigitalProjectView["tracks"][number] }) {
  const { t } = useSiteLanguage();
  const playerId = `digital-${useId()}`, audio = useRef<HTMLAudioElement>(null);
  const playbackIntent = useRef({ pending: false, intentionallyPaused: false });
  const [playing, setPlaying] = useState(false), [loading, setLoading] = useState(false), [failed, setFailed] = useState(false), [ended, setEnded] = useState(false), [current, setCurrent] = useState(0), [duration, setDuration] = useState((track.previewDurationMs ?? 0) / 1000);
  useEffect(() => listenForOtherMediaPlayback(playerId, () => {
    const element = audio.current; if (!element) return;
    playbackIntent.current.intentionallyPaused = playbackIntent.current.pending || !element.paused;
    element.pause();
  }), [playerId]);
  async function toggle() {
    const element = audio.current; if (!element) return;
    setFailed(false);
    if (!element.paused) { playbackIntent.current.intentionallyPaused = true; element.pause(); return; }
    playbackIntent.current.pending = true; playbackIntent.current.intentionallyPaused = false; setLoading(true);
    try { await element.play(); }
    catch (error) {
      if (!isDigitalIntentionalPlaybackAbort(error, playbackIntent.current.intentionallyPaused, element.paused, !!element.error)) setFailed(true);
    } finally { playbackIntent.current.pending = false; setLoading(false); }
  }
  return <li className={styles.trackRow} data-digital-preview={track.id} data-playing={playing ? "true" : "false"}>
    <audio ref={audio} src={track.previewUrl ?? undefined} preload="none" controlsList="nodownload noplaybackrate" onPlay={() => { setPlaying(true); setEnded(false); announceMediaPlayback({ ownerId: playerId, kind: "audio" }); }} onPause={() => setPlaying(false)} onLoadedMetadata={e => { if (Number.isFinite(e.currentTarget.duration)) setDuration(e.currentTarget.duration); }} onTimeUpdate={e => setCurrent(e.currentTarget.currentTime)} onEnded={e => { e.currentTarget.currentTime = 0; setPlaying(false); setEnded(true); setCurrent(0); }} onError={() => { setFailed(true); setPlaying(false); setLoading(false); }}/>
    <span className={styles.trackNumber}>{String(track.position).padStart(2, "0")}</span><div className={styles.trackIdentity}><strong><OriginalName>{track.title}</OriginalName></strong><span className={styles.muted}><OriginalName>{CATALOG_PRIMARY_ARTIST}</OriginalName></span><span className={styles.muted}>{track.fullDurationMs != null ? `${digitalTimeLabel(track.fullDurationMs)} · ${t("piste complète")}` : t("Durée complète non documentée")}</span></div><div className={styles.trackPlayback}>
    <button className={styles.trackPlay} type="button" onClick={() => void toggle()} disabled={loading || !track.previewUrl} aria-label={`${t(playing ? "Mettre en pause l’extrait de" : ended ? "Relire l’extrait de" : "Lire l’extrait de")} ${track.title}`}><StudioVinylControl state={loading ? "loading" : playing ? "pause" : ended ? "replay" : "play"}/></button>
    <span className={styles.previewCaption}>{track.previewUrl ? `${t("Extrait")} ${digitalTimeLabel(duration * 1000) ?? t("durée non documentée")}` : <T text="Extrait indisponible"/>}</span></div><div className={styles.trackPurchase}>{track.offer ? <AddDigitalOffer {...track.offer} title={track.title} owned={track.owned}/> : <span className={styles.muted}><T text={track.publication === "ANNOUNCED" ? "Titre annoncé — indisponible à l’achat" : "Indisponible à l’achat"}/></span>}</div>
    {(playing || current > 0) && track.previewUrl ? <div className={styles.trackProgress}><label><span className="sr-only">{t("Position dans l’extrait de")} <OriginalName>{track.title}</OriginalName></span><input type="range" min={0} max={Math.max(duration, 0)} step="0.1" value={Math.min(current, duration)} disabled={!duration || failed} onChange={e => { const next = Number(e.currentTarget.value); if (audio.current && Number.isFinite(next)) { audio.current.currentTime = next; setCurrent(next); setEnded(false); } }}/></label><output>{digitalTimeLabel(current * 1000)} / {digitalTimeLabel(duration * 1000)}</output></div> : null}
    {failed ? <span className={styles.playError} role="status"><T text="Lecture indisponible. Réessayez cet extrait."/></span> : null}
  </li>;
}
export function DigitalTracklist({ view, mode="TEST" }: { view: DigitalProjectView;mode?:DigitalUiMode }) {
  return <section className={styles.tracklist} aria-labelledby="digital-tracks-title"><header className={styles.tracklistHeading}><div className={styles.tracklistHeadingCopy}><p className={styles.tracklistKicker}><T text="Écouter et choisir"/></p><h2 id="digital-tracks-title"><T text="Les pistes."/></h2></div><span className={styles.tracklistAccent} aria-hidden="true"><span/><span/><span/><span/><span/></span></header>
    {view.membersPreviewOnly ? <p><Link href="/avant-premieres" className="text-link"><T text="Écouter les extraits réservés aux membres" /></Link></p> : null}
    <ol className={styles.trackRows}>{view.tracks.map(t => <DigitalTrackRow track={t} key={t.id}/>)}</ol>{!view.tracks.length ? <p><T text="Aucune piste publiée pour ce projet."/></p> : null}
    <details className={styles.qaDetails}><summary>{digitalUiIsLive(mode)?<T text="À propos des téléchargements"/>:<T text="À propos de cette démonstration"/>}</summary><p>{digitalUiIsLive(mode)?<T text="Panier numérique séparé et offres vérifiées côté serveur."/>:<T text="Prix fictifs, panier numérique séparé et offres vérifiées côté serveur."/>} <T text="Chaque extrait est un fichier autonome de 60 secondes maximum. Le master complet reste privé ;"/> {digitalUiIsLive(mode)?<T text="la licence incluse est limitée à l’usage privé, sans droit de publication ni d’exploitation commerciale."/>:<T text="aucune licence de publication n’est accordée par cette démo."/>}</p><p><T text="Le nombre de pistes de l’offre album correspond uniquement aux fichiers inclus à l’achat. Les titres annoncés ne sont pas vendus."/></p></details>
  </section>;
}
