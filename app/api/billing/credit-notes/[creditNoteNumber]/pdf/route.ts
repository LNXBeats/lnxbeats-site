import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/auth/session";
import { isActiveStatus } from "@/lib/auth/roles";
import { generateCreditNotePdf } from "@/lib/billing/pdf";
import { billingDocumentRenderMode } from "@/lib/billing/presentation";
import { getCreditNoteForAdmin, getCreditNoteForMember } from "@/lib/billing/service";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const numberPattern = /^AV-LNX-[0-9]{8}-[0-9]{4,}$/;

export async function GET(_request: Request, context: { params: Promise<{ creditNoteNumber: string }> }) {
  const session = await getAuthSession();
  if (!session || !isActiveStatus(session.user.status) || !session.user.emailVerified) return NextResponse.json({ ok: false }, { status: 401 });
  const { creditNoteNumber } = await context.params;
  if (!numberPattern.test(creditNoteNumber)) return NextResponse.json({ ok: false }, { status: 404 });
  const creditNote = session.user.role === "ADMIN"
    ? await getCreditNoteForAdmin(creditNoteNumber)
    : await getCreditNoteForMember(creditNoteNumber, session.user.id);
  if (!creditNote) return NextResponse.json({ ok: false }, { status: 404 });
  const pdf = await generateCreditNotePdf(creditNote, billingDocumentRenderMode(creditNote.invoice.payment.mode));
  await prisma.billingAuditEvent.create({ data: { invoiceId: creditNote.invoiceId, creditNoteId: creditNote.id, actorUserId: session.user.id, action: "CREDIT_NOTE_PDF_GENERATED" } });
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
