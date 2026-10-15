"""Render the professional review brief, not a replacement of any acquired contract."""
from pathlib import Path
import html
import re
import sys

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, LongTable, TableStyle
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'docs/DCN_FRANCE_PROFESSIONAL_VALIDATION_20261015.md'
DESTINATION = ROOT / 'output/pdf/dcn-france-validation-professionnelle.pdf'
FONT_ROOT = Path('/System/Library/Fonts/Supplemental')
for name, file in [('Review', 'Arial.ttf'), ('ReviewBold', 'Arial Bold.ttf'), ('ReviewItalic', 'Arial Italic.ttf')]:
    pdfmetrics.registerFont(TTFont(name, str(FONT_ROOT / file)))
pdfmetrics.registerFontFamily('Review', normal='Review', bold='ReviewBold', italic='ReviewItalic', boldItalic='ReviewBold')
styles = getSampleStyleSheet()
styles.add(ParagraphStyle('ReviewBody', fontName='Review', fontSize=9.4, leading=13.7, textColor=colors.HexColor('#22252A'), spaceAfter=6, splitLongWords=True, alignment=TA_LEFT))
styles.add(ParagraphStyle('ReviewTitle', parent=styles['ReviewBody'], fontName='ReviewBold', fontSize=21, leading=25, spaceAfter=14, keepWithNext=True))
styles.add(ParagraphStyle('ReviewH2', parent=styles['ReviewBody'], fontName='ReviewBold', fontSize=13, leading=17, textColor=colors.HexColor('#69501A'), spaceBefore=14, spaceAfter=7, keepWithNext=True))
styles.add(ParagraphStyle('ReviewH3', parent=styles['ReviewH2'], fontSize=10.8, leading=15, spaceBefore=9))
styles.add(ParagraphStyle('ReviewCell', parent=styles['ReviewBody'], fontSize=8.1, leading=11.5, spaceAfter=0))
styles.add(ParagraphStyle('ReviewList', parent=styles['ReviewBody'], leftIndent=12, firstLineIndent=-9))
styles.add(ParagraphStyle('ReviewQuote', parent=styles['ReviewBody'], leftIndent=10, rightIndent=10, borderColor=colors.HexColor('#D8C796'), borderWidth=0.5, borderPadding=7, backColor=colors.HexColor('#FBF8F0'), spaceBefore=4, spaceAfter=11))

def inline(text):
    value = html.escape(text, quote=True)
    value = re.sub(r'\[([^\]]+)\]\((https?://[^\s)]+)\)', lambda m: '<link href="' + m[2] + '" color="#69501A">' + m[1] + '</link>', value)
    value = re.sub(r'\[([^\]]+)\]\(([^\s)]+)\)', lambda m: m[1] + ' (annexe : ' + Path(m[2]).name + ')', value)
    value = re.sub(r'\*\*([^*]+)\*\*', r'<b>\1</b>', value)
    value = re.sub(r'`([^`]+)`', r'<font name="Courier" size="8.2">\1</font>', value)
    return value

def para(text, style='ReviewBody'):
    return Paragraph(inline(text), styles[style])

def parse_markdown(text):
    lines = text.splitlines()
    story = []
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue
        if line.startswith('> '):
            story.append(para(line[2:], 'ReviewQuote'))
            i += 1
            continue
        if line.startswith('|'):
            rows = []
            while i < len(lines) and lines[i].strip().startswith('|'):
                cells = [c.strip() for c in lines[i].strip().strip('|').split('|')]
                if not all(re.fullmatch(r':?-+:?', c) for c in cells):
                    rows.append(cells)
                i += 1
            count = len(rows[0])
            assert all(len(row) == count for row in rows)
            widths = {2: [134, 357], 3: [101, 195, 195], 4: [83, 136, 136, 136]}.get(count, [491 / count] * count)
            table = LongTable([[para(c, 'ReviewCell') for c in row] for row in rows], colWidths=widths, repeatRows=1, hAlign='LEFT')
            table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#F1E9D5')), ('VALIGN',(0,0),(-1,-1),'TOP'), ('LINEBELOW',(0,0),(-1,0),0.6,colors.HexColor('#9C7B30')), ('LINEBELOW',(0,1),(-1,-1),0.25,colors.HexColor('#DDDDDD')), ('TOPPADDING',(0,0),(-1,-1),6), ('BOTTOMPADDING',(0,0),(-1,-1),6), ('LEFTPADDING',(0,0),(-1,-1),6), ('RIGHTPADDING',(0,0),(-1,-1),6)]))
            story.extend([table, Spacer(1, 8)])
            continue
        match = re.match(r'^(#{1,3})\s+(.+)$', line)
        if match:
            story.append(para(match[2], {1:'ReviewTitle',2:'ReviewH2',3:'ReviewH3'}[len(match[1])]))
            i += 1
            continue
        match = re.match(r'^(?:[-*]|\d+[.)])\s+(.+)$', line)
        if match:
            prefix = line[:line.find(match[1])].strip()
            story.append(para(('•' if prefix in ['-', '*'] else prefix) + ' ' + match[1], 'ReviewList'))
            i += 1
            continue
        paragraph = [line]
        i += 1
        while i < len(lines) and lines[i].strip() and not re.match(r'^(?:#|\||[-*]\s|\d+[.)]\s)', lines[i].strip()):
            paragraph.append(lines[i].strip())
            i += 1
        story.append(para(' '.join(paragraph)))
    return story

def page_decoration(canvas, doc):
    width, height = A4
    canvas.saveState()
    canvas.setFont('ReviewBold', 8)
    canvas.setFillColor(colors.HexColor('#69501A'))
    canvas.drawString(52, height - 30, 'LNX BEATS / DCN FRANCE')
    canvas.setFont('Review', 7.5)
    canvas.drawRightString(width - 52, height - 30, 'DRAFT - validation professionnelle requise')
    canvas.setStrokeColor(colors.HexColor('#C3AA6D'))
    canvas.line(52, height - 38, width - 52, height - 38)
    canvas.setFillColor(colors.HexColor('#666666'))
    canvas.drawString(52, 27, '15 octobre 2026 - Aucun document contractuel approuve par ce dossier')
    canvas.drawRightString(width - 52, 27, f'{doc.page}')
    canvas.restoreState()

def main():
    assert len(sys.argv) == 1, 'No remote input or profile accepted.'
    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    text = SOURCE.read_text()
    assert 'DRAFT' in text
    doc = SimpleDocTemplate(str(DESTINATION), pagesize=A4, leftMargin=52, rightMargin=52, topMargin=54, bottomMargin=48, title='Validation professionnelle du commerce musical DCN France', author='LNX Beats', pageCompression=1)
    doc.build(parse_markdown(text), onFirstPage=page_decoration, onLaterPages=page_decoration)
    reader = PdfReader(DESTINATION)
    assert len(reader.pages) >= 2
    assert all(len(p.extract_text().strip()) > 100 for p in reader.pages)
    print(f'PDF_PAGES={len(reader.pages)}')
    print(f'PDF_OUTPUT={DESTINATION}')

if __name__ == '__main__':
    main()
