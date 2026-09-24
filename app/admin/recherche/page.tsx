import type { Metadata } from "next";
import Link from "next/link";

import { AdminIcon } from "@/components/admin-icons";
import { requireAdmin } from "@/lib/auth/session";
import { normalizeAdminSearchQuery, searchAdminRecords } from "@/lib/admin/search";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Recherche · Administration", robots: { index: false, follow: false } };

export default async function AdminSearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireAdmin();
  const query = normalizeAdminSearchQuery((await searchParams).q);
  const results = query ? await searchAdminRecords(query) : [];
  return <main className="admin-main admin-search-results">
    <header className="admin-page-heading"><div><p className="admin-kicker">Recherche privée</p><h1>Retrouver un dossier.</h1></div><p>Commandes, créations, projets, membres et documents accessibles à l’Administration. Résultats limités par catégorie.</p></header>
    {!query ? <div className="admin-empty"><h2>Saisissez au moins deux caractères.</h2><p>La recherche ne lance aucune action métier.</p></div>
      : <section className="admin-list-window" aria-labelledby="admin-search-title"><div className="admin-list-window__heading"><h2 id="admin-search-title">Résultats pour « {query} »</h2><span>{results.length} résultat{results.length === 1 ? "" : "s"}</span></div>
        {results.length ? <ul className="admin-v21-search-list">{results.map((result) => <li key={result.key}><Link href={result.href}><span><small>{result.type}</small><strong>{result.title}</strong><em>{result.detail}</em></span><AdminIcon name="arrow" /></Link></li>)}</ul>
          : <div className="admin-empty"><h2>Aucun résultat.</h2><p>Essayez une référence, un titre, un nom ou une adresse e-mail.</p></div>}</section>}
  </main>;
}
