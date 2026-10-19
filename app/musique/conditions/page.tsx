
import { T, ContractLanguageNotice } from "@/components/site-language";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Container } from "@/components/container";
import { DigitalDemoBanner, DigitalCartNavigation } from "@/components/digital-navigation";
import { requireDigitalEnvironment } from "@/lib/digital/domain";
import { digitalMusicTermsDraft,digitalPrivacyAddendumDraft } from "@/lib/digital/digital-legal";
import {digitalFranceTermsDraft} from "@/lib/digital/france-legal";
import styles from "@/components/digital.module.css";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { approvedDigitalFranceContract } from "@/lib/digital/contract-approval-service";
import { digitalFranceLiveContractCandidate } from "@/lib/digital/france-live-contract";
import { approvedDigitalFranceContractPublication } from "@/lib/digital/france-contract-publication";
export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Conditions de vente de musique numérique",robots:{index:false,follow:false}};
export default async function Page(){let mode;try{mode=requireDigitalEnvironment();}catch{notFound();}
  if(mode==="LIVE"){
    let publication=null;try{publication=approvedDigitalFranceContractPublication(await approvedDigitalFranceContract(prisma));}catch{/* Unapproved or unreadable decisions never become public approval claims. */}
    const d=digitalFranceLiveContractCandidate;
    return <section className={styles.shell}><Container><DigitalCartNavigation/>
      <ContractLanguageNotice/>
      <p className={styles.note}><T text={publication?"Conditions applicables aux nouvelles commandes numériques éligibles. Les achats antérieurs conservent leurs conditions et documents dans Ma musique.":"Ces conditions sont présentées pour consultation. Elles ne sont pas disponibles pour conclure un nouvel achat actuellement."}/></p>
      <article id="dcn-france-terms" className={styles.panel} lang="fr" translate="no"><h1>{d.title}</h1>{publication?<p>{publication.label}</p>:null}{d.sections.map(s=><section key={s.title} className={s.boxed?styles.panel:undefined}><h2>{s.title}</h2>{s.paragraphs.map((p,i)=><p key={i}>{p}</p>)}</section>)}</article>
      <Link className="text-link" href="/confidentialite"><T text="Consulter la politique de confidentialité" /></Link>
    </Container></section>;
  }
  return <section className={styles.shell}><Container><DigitalCartNavigation/><DigitalDemoBanner mode={mode}/>
    <ContractLanguageNotice/>
    <p className={styles.note}><T text="Documents de démonstration : ils ne permettent pas une vente réelle. Les documents propres à chaque achat restent dans Ma musique." /></p>
    {[digitalFranceTermsDraft,digitalPrivacyAddendumDraft].map(d=><article lang="fr" translate="no" id={d.version===digitalFranceTermsDraft.version?"dcn-france-terms":undefined} key={d.version} className={styles.panel}><h1>{d.title}</h1>
      {d.sections.map(s=><section key={s.title} className={"boxed" in s&&s.boxed?styles.panel:undefined}><h2>{s.title}</h2>{s.paragraphs.map((p,i)=><p key={i}>{p}</p>)}</section>)}</article>)}
    <details className={styles.panel}><summary><T text="Conditions de démonstration antérieures" /></summary><div lang="fr" translate="no">{digitalMusicTermsDraft.sections.map(s=><section key={s.title}><h2>{s.title}</h2>{s.paragraphs.map((p,i)=><p key={i}>{p}</p>)}</section>)}</div></details>
  </Container></section>;
}
