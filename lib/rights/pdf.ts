import "server-only";

import { createHash } from "node:crypto";

import PDFDocument from "pdfkit";

export type ContractPdfSection = Readonly<{
  title: string;
  paragraphs: readonly string[];
}>;

export type ContractPdfInput = Readonly<{
  contractNumber: string;
  requestNumber: string;
  orderNumber: string;
  title: string;
  statusLabel: string;
  templateVersion: number;
  generatedAt: Date;
  legalTemplateApproved: boolean;
  kind: "PREAUTHORIZATION" | "CONTRACT" | "ACCEPTANCE_RECEIPT" | "SACEM_PREPARATION";
  sections: readonly ContractPdfSection[];
}>;

const A4 = { width: 595.28, height: 841.89 } as const;
const PAGE_MARGIN = 56;
// Keep a safety band above PDFKit's automatic bottom-margin page break. Text
// metrics can differ by fractions of a point once WinAnsi glyphs are encoded;
// an explicit band ensures every continuation goes through addPage(), which
// redraws the branded header and keeps body text clear of the footer.
const CONTENT_BOTTOM = A4.height - 92;
const CONTENT_WIDTH = A4.width - PAGE_MARGIN * 2;
const SECTION_TITLE_SIZE = 11.5;
const SECTION_BODY_SIZE = 9.3;
const SECTION_LINE_GAP = 1.6;
const SECTION_PARAGRAPH_GAP = 3;
const SECTION_HEADING_GAP = 3.5;
const SECTION_GAP = 5;
const WATERMARK = "PROJET - NON ACTIF - VALIDATION JURIDIQUE REQUISE";

function parisDate(value: Date) {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(value);
}

function shortHash(input: ContractPdfInput) {
  const canonical = JSON.stringify({
    contractNumber: input.contractNumber,
    requestNumber: input.requestNumber,
    orderNumber: input.orderNumber,
    title: input.title,
    statusLabel: input.statusLabel,
    templateVersion: input.templateVersion,
    generatedAt: input.generatedAt.toISOString(),
    legalTemplateApproved: input.legalTemplateApproved,
    kind: input.kind,
    sections: input.sections,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 12).toUpperCase();
}

function assertPdfText(value: string, max: number, label: string) {
  if (!value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new TypeError(`${label} is invalid.`);
  }
}

function validateInput(input: ContractPdfInput) {
  assertPdfText(input.contractNumber, 32, "Contract number");
  assertPdfText(input.requestNumber, 32, "Request number");
  assertPdfText(input.orderNumber, 32, "Order number");
  assertPdfText(input.title, 240, "Title");
  assertPdfText(input.statusLabel, 120, "Status");
  if (!Number.isInteger(input.templateVersion) || input.templateVersion < 1) throw new TypeError("Template version is invalid.");
  if (Number.isNaN(input.generatedAt.getTime())) throw new TypeError("Generated date is invalid.");
  if (input.sections.length < 1 || input.sections.length > 40) throw new TypeError("PDF sections are invalid.");
  for (const section of input.sections) {
    assertPdfText(section.title, 180, "Section title");
    if (section.paragraphs.length < 1 || section.paragraphs.length > 80) throw new TypeError("PDF paragraphs are invalid.");
    for (const paragraph of section.paragraphs) assertPdfText(paragraph, 12_000, "Paragraph");
  }
}

export function contractPdfSourceHash(input: ContractPdfInput) {
  validateInput(input);
  return createHash("sha256").update(JSON.stringify(input, (_key, value) => value instanceof Date ? value.toISOString() : value), "utf8").digest("hex");
}

export async function generateContractPdf(input: ContractPdfInput) {
  validateInput(input);
  const visibleHash = shortHash(input);
  const document = new PDFDocument({
    autoFirstPage: false,
    bufferPages: true,
    compress: true,
    size: "A4",
    margins: { top: 70, right: PAGE_MARGIN, bottom: 70, left: PAGE_MARGIN },
    info: {
      Title: input.title,
      Author: "LNX Beats",
      Subject: `${input.kind} - ${input.statusLabel}`,
      Keywords: `LNX Studio, ${input.requestNumber}, ${input.orderNumber}`,
      Creator: "LNX Studio V0.7.2",
      Producer: "LNX Studio V0.7.2",
      CreationDate: input.generatedAt,
      ModDate: input.generatedAt,
    },
  });
  const chunks: Buffer[] = [];
  document.on("data", (chunk: Buffer) => chunks.push(chunk));
  const completion = new Promise<Buffer>((resolve, reject) => {
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });

  function addPage() {
    document.addPage({ size: "A4", margins: { top: 70, right: PAGE_MARGIN, bottom: 70, left: PAGE_MARGIN } });
    document.save();
    document.rect(0, 0, A4.width, 12).fill("#caa36a");
    document.fillColor("#1d2026").font("Helvetica-Bold").fontSize(9).text("LNX STUDIO", PAGE_MARGIN, 34, { characterSpacing: 1.4 });
    document.fillColor("#6b7280").font("Helvetica").fontSize(8).text(input.contractNumber, A4.width - PAGE_MARGIN - 190, 34, { width: 190, align: "right" });
    document.restore();
    document.x = PAGE_MARGIN;
    document.y = 70;
  }

  function ensureSpace(height: number) {
    if (document.y + height > CONTENT_BOTTOM) addPage();
  }

  function sectionHeight(section: ContractPdfSection) {
    document.font("Helvetica-Bold").fontSize(SECTION_TITLE_SIZE);
    let height = document.heightOfString(section.title, { width: CONTENT_WIDTH });
    height += SECTION_HEADING_GAP;
    document.font("Helvetica").fontSize(SECTION_BODY_SIZE);
    for (const paragraph of section.paragraphs) {
      height += document.heightOfString(paragraph, { width: CONTENT_WIDTH, lineGap: SECTION_LINE_GAP });
      height += SECTION_PARAGRAPH_GAP;
    }
    return height + SECTION_GAP;
  }

  addPage();
  document.fillColor("#1d2026").font("Helvetica-Bold").fontSize(21).text(input.title, { align: "left" });
  document.moveDown(0.35);
  document.fillColor("#9b6a2f").font("Helvetica-Bold").fontSize(10).text(input.statusLabel.toUpperCase(), { characterSpacing: 0.8 });
  document.moveDown(0.75);
  document.fillColor("#4b5563").font("Helvetica").fontSize(9.5);
  document.text(`Généré le ${parisDate(input.generatedAt)} - Modèle version ${input.templateVersion}`);
  document.text(`Commande ${input.orderNumber} - Demande ${input.requestNumber}`);
  document.text(`Empreinte visible ${visibleHash}`);

  if (!input.legalTemplateApproved || input.kind === "PREAUTHORIZATION" || input.kind === "SACEM_PREPARATION") {
    document.moveDown(1);
    const boxY = document.y;
    document.roundedRect(PAGE_MARGIN, boxY, A4.width - PAGE_MARGIN * 2, 48, 8).fill("#fff4dd");
    document.fillColor("#7a4e16").font("Helvetica-Bold").fontSize(10).text(WATERMARK, PAGE_MARGIN + 16, boxY + 14, {
      width: A4.width - PAGE_MARGIN * 2 - 32,
      align: "center",
    });
    document.y = boxY + 62;
  } else {
    document.moveDown(1.4);
  }

  const firstSectionY = document.y;
  const measuredSections = input.sections.map(sectionHeight);
  const totalSectionHeight = measuredSections.reduce((sum, height) => sum + height, 0);
  const firstPageCapacity = CONTENT_BOTTOM - firstSectionY;
  const followingPageCapacity = CONTENT_BOTTOM - 70;
  let balancedBreakIndex: number | null = null;

  // When the document needs exactly two pages, choose a section boundary that
  // fills both available areas proportionally. This avoids a nearly empty
  // second page while preserving every section as a coherent block.
  if (totalSectionHeight > firstPageCapacity && totalSectionHeight <= firstPageCapacity + followingPageCapacity) {
    const targetFirstPageHeight = totalSectionHeight * firstPageCapacity / (firstPageCapacity + followingPageCapacity);
    let cumulative = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 1; index < measuredSections.length; index += 1) {
      cumulative += measuredSections[index - 1]!;
      const remaining = totalSectionHeight - cumulative;
      if (cumulative > firstPageCapacity || remaining > followingPageCapacity) continue;
      const distance = Math.abs(cumulative - targetFirstPageHeight);
      if (distance < bestDistance) {
        bestDistance = distance;
        balancedBreakIndex = index;
      }
    }
  }

  for (const [index, section] of input.sections.entries()) {
    if (balancedBreakIndex === index) addPage();
    const measuredHeight = measuredSections[index]!;
    if (measuredHeight <= followingPageCapacity) ensureSpace(measuredHeight);
    document.x = PAGE_MARGIN;
    document.fillColor("#1d2026").font("Helvetica-Bold").fontSize(SECTION_TITLE_SIZE);
    const titleY = document.y;
    const titleHeight = document.heightOfString(section.title, { width: CONTENT_WIDTH });
    document.text(section.title, PAGE_MARGIN, titleY, {
      width: CONTENT_WIDTH,
      continued: false,
    });
    document.y = titleY + titleHeight + SECTION_HEADING_GAP;
    for (const paragraph of section.paragraphs) {
      const paragraphHeight = document.font("Helvetica").fontSize(SECTION_BODY_SIZE).heightOfString(paragraph, {
        width: CONTENT_WIDTH,
        lineGap: SECTION_LINE_GAP,
      });
      if (paragraphHeight <= followingPageCapacity) ensureSpace(paragraphHeight + SECTION_PARAGRAPH_GAP);
      document.x = PAGE_MARGIN;
      document.fillColor("#30343b").font("Helvetica").fontSize(SECTION_BODY_SIZE);
      const paragraphY = document.y;
      document.text(paragraph, PAGE_MARGIN, paragraphY, {
        width: CONTENT_WIDTH,
        align: "left",
        lineGap: SECTION_LINE_GAP,
      });
      document.y = paragraphY + paragraphHeight + SECTION_PARAGRAPH_GAP;
    }
    document.y += SECTION_GAP;
  }

  const range = document.bufferedPageRange();
  for (let index = 0; index < range.count; index += 1) {
    document.switchToPage(index);
    document.page.margins.bottom = 0;
    document.save();
    document.fillColor("#6b7280").font("Helvetica").fontSize(8);
    document.text(`Page ${index + 1} / ${range.count}`, PAGE_MARGIN, A4.height - 42, {
      width: A4.width - PAGE_MARGIN * 2,
      align: "center",
      lineBreak: false,
    });
    document.text(`Document privé - ${visibleHash}`, PAGE_MARGIN, A4.height - 30, {
      width: A4.width - PAGE_MARGIN * 2,
      align: "center",
      lineBreak: false,
    });
    document.restore();
  }

  document.end();
  const output = await completion;
  if (output.length < 1_000 || !output.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new Error("Generated contract PDF is invalid.");
  }
  return {
    bytes: output,
    sha256: createHash("sha256").update(output).digest("hex"),
    sourceHashSha256: contractPdfSourceHash(input),
    visibleHash,
    pageCount: range.count,
  };
}

export const contractDraftWatermark = WATERMARK;
