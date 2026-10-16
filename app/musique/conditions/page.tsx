import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Container } from "@/components/container";
import { DigitalDemoBanner, DigitalCartNavigation } from "@/components/digital-navigation";
import { requireDigitalEnvironment } from "@/lib/digital/domain";
import { digitalMusicTermsDraft,digitalPrivacyAddendumDraft } from "@/lib/digital/digital-legal";
import {digitalFranceTermsDraft,DIGITAL_FRANCE_TERMS_TEXT_HASH} from "@/lib/digital/france-legal";
import styles from "@/components/digital.module.css";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { approvedDigitalFranceContract } from "@/lib/digital/contract-approval-service";
import { digitalFranceLiveContractCandidate } from "@/lib/digital/france-live-contract";
export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Conditions numériques proposées",robots:{index:false,follow:false}};
export default async function Page(){let mode;try{mode=requireDigitalEnvironment();}catch{notFound();}
  if(mode==="LIVE"){
    let approved=false;try{await approvedDigitalFranceContract(prisma);approved=true;}catch{/* Unapproved or unreadable decisions never become public approval claims. */}
    const d=digitalFranceLiveContractCandidate;
    return <section className={styles.shell}><Container><DigitalCartNavigation/>
      <p className={styles.note}>{approved?"Conditions applicables aux nouvelles commandes numériques éligibles. Les achats antérieurs conservent leur version contractuelle et leurs documents dans Ma musique.":"DRAFT — conditions proposées, non encore approuvées. Aucun nouvel achat ne peut être conclu avec ce brouillon."}</p>
      <article id="dcn-france-terms" className={styles.panel}><h1>{d.title}</h1><p>Version {d.version} · {approved?"approbation du vendeur enregistrée":"DRAFT — non approuvé pour LIVE"}.</p><p className={styles.muted}>Empreinte SHA-256 du texte : {d.textHashSha256}.</p>{d.sections.map(s=><section key={s.title} className={s.boxed?styles.panel:undefined}><h2>{s.title}</h2>{s.paragraphs.map((p,i)=><p key={i}>{p}</p>)}</section>)}</article>
      <Link className="text-link" href="/confidentialite">Consulter la politique de confidentialité</Link>
    </Container></section>;
  }
  return <section className={styles.shell}><Container><DigitalCartNavigation/><DigitalDemoBanner mode={mode}/>
    <p className={styles.note}>Le brouillon France est proposé uniquement aux nouvelles commandes QA. Il ne s’applique pas en LIVE. Les acquisitions antérieures conservent leurs conditions figées ; les documents propres à chaque achat restent dans Ma musique.</p>
    {[digitalFranceTermsDraft,digitalPrivacyAddendumDraft].map(d=><article id={d.version===digitalFranceTermsDraft.version?"dcn-france-terms":undefined} key={d.version} className={styles.panel}><h1>{d.title}</h1><p className={styles.note}>DRAFT — non approuvé, non applicable en LIVE. Version {d.version}.</p>{d.version===digitalFranceTermsDraft.version?<p>Empreinte SHA-256 du texte accepté en QA : {DIGITAL_FRANCE_TERMS_TEXT_HASH}.</p>:null}
      {d.sections.map(s=><section key={s.title} className={"boxed" in s&&s.boxed?styles.panel:undefined}><h2>{s.title}</h2>{s.paragraphs.map((p,i)=><p key={i}>{p}</p>)}</section>)}</article>)}
    <details className={styles.panel}><summary>Conditions de démonstration QA conservées — {digitalMusicTermsDraft.version}</summary>{digitalMusicTermsDraft.sections.map(s=><section key={s.title}><h2>{s.title}</h2>{s.paragraphs.map((p,i)=><p key={i}>{p}</p>)}</section>)}</details>
  </Container></section>;
}
