import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/auth/session";
import { isActiveStatus } from "@/lib/auth/roles";
import { generateInvoicePdf } from "@/lib/billing/pdf";
import { getInvoiceForAdmin, getInvoiceForMember } from "@/lib/billing/service";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const numberPattern = /^LNX-[0-9]{8}-[0-9]{4,}$/;

export async function GET(_request: Request, context: { params: Promise<{ invoiceNumber: string }> }) {
  const session = await getAuthSession();
  if (!session || !isActiveStatus(session.user.status) || !session.user.emailVerified) return NextResponse.json({ ok: false }, { status: 401 });
  const { invoiceNumber } = await context.params;
  if (!numberPattern.test(invoiceNumber)) return NextResponse.json({ ok: false }, { status: 404 });
  const invoice = session.user.role === "ADMIN"
    ? await getInvoiceForAdmin(invoiceNumber)
    : await getInvoiceForMember(invoiceNumber, session.user.id);
  if (!invoice) return NextResponse.json({ ok: false }, { status: 404 });
  const pdf = await generateInvoicePdf(invoice, true);
  await prisma.billingAuditEvent.create({ data: { invoiceId: invoice.id, actorUserId: session.user.id, action: "INVOICE_PDF_GENERATED" } });
  return new NextResponse(new Uint8Array(pdf.bytes), {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": `attachment; filename="${pdf.filename}"`,
      "Content-Type": "application/pdf",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
