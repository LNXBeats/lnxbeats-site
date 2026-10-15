import Link from "next/link";
import type {Metadata} from "next";
import {notFound} from "next/navigation";
import {requireAdmin} from "@/lib/auth/session";
import {requireDigitalEnvironment} from "@/lib/digital/domain";
import {listDigitalFranceResidenceQueueV2} from "@/lib/digital/france-residence-v2-service";
import type {OrderActor} from "@/lib/orders/domain";
import styles from "@/components/digital.module.css";
export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Résidence DCN — revue privée",robots:{index:false,follow:false}};
export default async function Page(){try{requireDigitalEnvironment();}catch{notFound();}const s=await requireAdmin(),actor={id:s.user.id,email:s.user.email,name:s.user.name,role:s.user.role,status:"ACTIVE",emailVerified:s.user.emailVerified} as OrderActor;
  const queue=await listDigitalFranceResidenceQueueV2(actor);
  return <div className="admin-main"><Link href="/admin/musique">Retour à la musique numérique</Link><h1>Résidences — revue privée DCN</h1><p className={styles.note}>Déclarations client, pas preuves automatiques. Aucune collecte d’identité systématique ; aucune ouverture fiscale, juridique ou LIVE. Les 50 derniers enregistrements sont affichés au maximum.</p>
    {!queue.entries.length?<p>Aucune déclaration de résidence enregistrée.</p>:queue.entries.map(entry=><section className={styles.panel} key={entry.declarationId}><h2>{entry.postalCode} · {entry.city}</h2><p>Déclaration du {entry.createdAt} · compte …{entry.subjectUserId.slice(-8)}</p><Link href={`/admin/musique/residences/${entry.subjectUserId}`}>Examiner la déclaration et les états</Link></section>)}
    {queue.truncated?<p>Historique borné : seuls les derniers enregistrements sont affichés. Les événements précédents restent conservés ; ouvrez un compte précis par son identifiant si nécessaire.</p>:null}
  </div>;
}
