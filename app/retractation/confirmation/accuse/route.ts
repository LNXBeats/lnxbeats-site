import { cookies } from "next/headers";
import { getWithdrawalReceipt } from "@/lib/legal/withdrawal";
import { withdrawalReceiptText } from "@/lib/legal/withdrawal-policy";

export const dynamic = "force-dynamic";
export async function GET() {
  const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
  const receipt = await getWithdrawalReceipt((await cookies()).get("lnx-withdrawal-receipt")?.value).catch(() => null);
  if (!receipt) return new Response("Accusé indisponible.", { status: 404, headers });
  try {
    return new Response(withdrawalReceiptText(receipt.acknowledgementSnapshot, receipt.acknowledgementHashSha256), { headers: {
      ...headers, "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="${receipt.requestNumber}.txt"`,
    } });
  } catch { return new Response("Accusé indisponible.", { status: 503, headers }); }
}
