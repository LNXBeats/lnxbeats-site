import { serializeStructuredData } from "@/lib/seo/structured-data";

export function JsonLd({ data, id }: Readonly<{ data: unknown; id: string }>) {
  return <script id={id} type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeStructuredData(data) }} />;
}
