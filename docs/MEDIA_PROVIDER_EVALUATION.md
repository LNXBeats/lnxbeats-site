# Évaluation du stockage objet — V0.6.3

Évaluation effectuée le 13 août 2026 à partir des documentations officielles. Les tarifs doivent être revérifiés avant activation production.

| Solution | Coût / egress | S3 / Range / URL signée | Exploitation LNX Studio | Décision |
| --- | --- | --- | --- | --- |
| Cloudflare R2 Standard | 0,015 $/Go-mois, 10 Go-mois gratuits, egress Internet gratuit ; opérations A/B facturées au-delà du niveau gratuit | API S3, `GetObject Range`, multipart, AWS SDK v3, URLs pré-signées GET/PUT/HEAD/DELETE | Deux buckets simples, credentials serveur Railway, forte cohérence, 11 neuf de durabilité annoncés | **Retenu** |
| AWS S3 Standard | tarification régionale du stockage, des requêtes et du transfert sortant ; 100 Go/mois de transfert Internet sortant gratuits au niveau compte indiqué par AWS | référence S3 complète, Range, multipart, IAM et URLs pré-signées | Très robuste mais coût/paramétrage plus complexes pour un petit catalogue public hors AWS | Compatible avec l’adaptateur, non retenu par défaut |
| Backblaze B2 | à partir de 6,95 $/To-mois ; egress gratuit jusqu’à 3× le stockage moyen, puis 0,01 $/Go hors partenaires | API S3-compatible, buckets public/privé, Range/CORS et URLs pré-signées | Bon coût stockage, politique egress moins directe que R2 pour une écoute publique répétée | Alternative crédible |
| Supabase Storage Pro | plan à partir de 25 $/mois ; 100 Go stockage puis 0,0213 $/Go, 250 Go cached/uncached inclus puis 0,03/0,09 $/Go | compatibilité S3 partielle, Range et presigning ; REST/CDN/RLS supplémentaires | Fonctionnel mais ajoute une plateforme et un modèle de permissions alors que PostgreSQL/Auth existent déjà | Non retenu |

## Raisons du choix

R2 correspond au trafic attendu de covers et previews : objets fréquemment lus, egress public potentiellement dominant, fichiers sources/futurs masters pouvant dépasser la taille des images. R2 Standard n’impose ni frais de récupération ni durée minimale, supporte des objets jusqu’à 5 TiB (upload simple jusqu’à 5 GiB, multipart au-delà) et les opérations utilisées par l’adaptateur. L’absence de frais egress réduit le principal risque budgétaire du jukebox.

Le choix reste réversible : clés et métadonnées appartiennent à LNX Studio, les deux buckets sont adressés par une interface interne, et le seul SDK est AWS SDK v3 dans `lib/media/storage/s3.ts`.

## Sources officielles

- [Cloudflare R2 — tarifs](https://developers.cloudflare.com/r2/pricing/)
- [Cloudflare R2 — compatibilité S3 et Range](https://developers.cloudflare.com/r2/api/s3/api/)
- [Cloudflare R2 — URLs pré-signées](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [Cloudflare R2 — limites](https://developers.cloudflare.com/r2/platform/limits/)
- [Cloudflare R2 — durabilité](https://developers.cloudflare.com/r2/reference/durability/)
- [Amazon S3 — tarifs](https://aws.amazon.com/s3/pricing/)
- [Amazon S3 — URLs pré-signées](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)
- [Backblaze B2 — tarifs](https://www.backblaze.com/cloud-storage/pricing)
- [Backblaze B2 — API S3-compatible](https://www.backblaze.com/docs/cloud-storage-s3-compatible-api)
- [Supabase Storage — tarifs](https://supabase.com/pricing)
- [Supabase Storage — compatibilité S3](https://supabase.com/docs/guides/storage/s3/compatibility)
