import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Container } from "@/components/container";
import { DigitalDemoBanner, DigitalCartNavigation } from "@/components/digital-navigation";
import { requireDigitalEnvironment } from "@/lib/digital/domain";
import { digitalMusicTermsDraft,digitalPrivacyAddendumDraft } from "@/lib/digital/digital-legal";
import {digitalFranceTermsDraft} from "@/lib/digital/france-legal";
import styles from "@/components/digital.module.css";
export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Conditions numériques proposées",robots:{index:false,follow:false}};
export default function Page(){try{requireDigitalEnvironment();}catch{notFound();}
  return <section className={styles.shell}><Container><DigitalCartNavigation/><DigitalDemoBanner/>
    <p className={styles.note}>Le brouillon France prépare le lancement retenu ; il n’est pas encore activé. Les démonstrations QA et les acquisitions antérieures conservent leurs conditions figées, consultables ci-dessous.</p>
    {[digitalFranceTermsDraft,digitalPrivacyAddendumDraft].map(d=><article key={d.version} className={styles.panel}><h1>{d.title}</h1><p className={styles.note}>DRAFT — non approuvé, non applicable en LIVE. Version {d.version}.</p>
      {d.sections.map(s=><section key={s.title}><h2>{s.title}</h2>{s.paragraphs.map((p,i)=><p key={i}>{p}</p>)}</section>)}</article>)}
    <details className={styles.panel}><summary>Conditions de démonstration QA conservées — {digitalMusicTermsDraft.version}</summary>{digitalMusicTermsDraft.sections.map(s=><section key={s.title}><h2>{s.title}</h2>{s.paragraphs.map((p,i)=><p key={i}>{p}</p>)}</section>)}</details>
  </Container></section>;
}
