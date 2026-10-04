import { validatedAdsTxt } from "@/lib/ads/policy";

export const dynamic = "force-dynamic";
export function GET() {
  const content = validatedAdsTxt(process.env);
  return new Response(content ?? "", {
    status: content ? 200 : 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}
