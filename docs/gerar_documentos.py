# -*- coding: utf-8 -*-
"""Gera a apresentação PPTX (chefes) e o PDF técnico (eletrônica)."""
from __future__ import annotations

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.util import Inches, Pt, Emu
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm, mm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, ListFlowable, ListItem, KeepTogether, HRFlowable,
)

ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / "assets"
ASSETS.mkdir(exist_ok=True)

# Cores da marca
BG = (15, 17, 21)
PANEL = (25, 28, 35)
PANEL2 = (34, 38, 49)
TEXT = (238, 241, 246)
MUTED = (139, 147, 167)
ACCENT = (255, 204, 0)
GREEN = (34, 197, 94)
BLUE = (59, 130, 246)
RED = (239, 68, 68)
ORANGE = (249, 115, 22)
WHITE = (255, 255, 255)
BLACK = (0, 0, 0)


def font(size, bold=False):
    candidates = [
        "C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def rounded(draw, box, fill, radius=18):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def diagram_overview(path: Path):
    """Diagrama tablet + pulseira para a apresentação."""
    w, h = 1600, 900
    img = Image.new("RGB", (w, h), BG)
    d = ImageDraw.Draw(img)
    f_title = font(36, True)
    f = font(26)
    f_sm = font(20)
    f_tiny = font(16)

    d.text((48, 28), "SISTEMA DE CRONOMETRAGEM DE PIT STOP", fill=ACCENT, font=f_title)
    d.text((48, 78), "Só dois equipamentos a bateria · montagem em ~2 minutos", fill=MUTED, font=f_sm)

    # Tablet
    tx, ty = 980, 140
    rounded(d, (tx, ty, tx + 520, ty + 680), PANEL, 28)
    rounded(d, (tx + 28, ty + 40, tx + 492, ty + 620), PANEL2, 12)
    d.text((tx + 200, ty + 70), "TABLET", fill=MUTED, font=f_sm)
    d.text((tx + 120, ty + 130), "tempo  3,12 s", fill=ACCENT, font=f_title)
    d.text((tx + 70, ty + 200), "Ranking do dia", fill=MUTED, font=f_sm)
    for i, ww in enumerate([360, 300, 320]):
        rounded(d, (tx + 70, ty + 240 + i * 36, tx + 70 + ww, ty + 260 + i * 36), (50, 55, 70), 6)
    rounded(d, (tx + 90, ty + 420, tx + 430, ty + 500), GREEN, 14)
    d.text((tx + 190, ty + 445), "PRONTO", fill=WHITE, font=f_title)
    # badges
    d.ellipse((tx + 450, ty + 430, tx + 490, ty + 470), fill=ACCENT)
    d.text((tx + 462, ty + 438), "1", fill=BLACK, font=f)
    d.ellipse((tx + 450, ty + 120, tx + 490, ty + 160), fill=ACCENT)
    d.text((tx + 462, ty + 128), "4", fill=BLACK, font=f)

    # Mechanic + car
    mx, my = 80, 180
    # car body
    rounded(d, (mx, my + 160, mx + 280, my + 380), PANEL2, 24)
    d.ellipse((mx + 160, my + 340, mx + 300, my + 480), outline=TEXT, width=4)
    d.ellipse((mx + 195, my + 375, mx + 265, my + 445), fill=PANEL)
    d.ellipse((mx + 220, my + 400, mx + 240, my + 420), fill=ACCENT)
    # body (mechanic)
    d.line([(mx + 380, my + 120), (mx + 360, my + 280)], fill=TEXT, width=10)
    d.line([(mx + 360, my + 280), (mx + 320, my + 460)], fill=TEXT, width=10)
    d.line([(mx + 360, my + 280), (mx + 420, my + 460)], fill=TEXT, width=10)
    # free arm UP
    d.line([(mx + 375, my + 140), (mx + 410, my + 40)], fill=TEXT, width=10)
    # gun arm DOWN
    d.line([(mx + 370, my + 160), (mx + 300, my + 320)], fill=TEXT, width=10)
    # head
    d.ellipse((mx + 360, my + 70, mx + 410, my + 120), outline=TEXT, width=4)
    # gun
    rounded(d, (mx + 250, my + 310, mx + 310, my + 340), MUTED, 6)
    rounded(d, (mx + 285, my + 340, mx + 305, my + 370), MUTED, 4)
    # bracelet on free arm
    rounded(d, (mx + 395, my + 55, mx + 430, my + 85), BLUE, 6)
    d.text((mx + 445, my + 55), "pulseira", fill=BLUE, font=f_sm)
    # beep arcs
    d.arc((mx + 330, my + 5, mx + 390, my + 65), 200, 340, fill=MUTED, width=3)
    d.arc((mx + 310, my - 15, mx + 410, my + 85), 200, 340, fill=MUTED, width=2)
    d.text((mx + 280, my + 5), "bipe", fill=MUTED, font=f_tiny)
    d.ellipse((mx + 300, my + 95, mx + 340, my + 135), fill=ACCENT)
    d.text((mx + 312, my + 103), "2", fill=BLACK, font=f)
    d.ellipse((mx + 405, my + 5, mx + 445, my + 45), fill=ACCENT)
    d.text((mx + 417, my + 13), "3", fill=BLACK, font=f)

    # BLE link
    d.line([(mx + 460, my + 100), (tx - 20, my + 180)], fill=BLUE, width=3)
    # dashed feel via small segments - already solid blue
    d.text((620, 220), "Bluetooth LE", fill=BLUE, font=f)
    d.text((600, 255), "PRONTO  →  tempo", fill=MUTED, font=f_sm)

    # legend steps
    steps = [
        "1  Equipe toca PRONTO no tablet",
        "2  Pulseira apita (largada) e marca t0",
        "3  Braço livre levantado → marca t1",
        "4  Tempo t1−t0 volta ao tablet + vídeo cortado",
    ]
    for i, s in enumerate(steps):
        d.text((48, 720 + i * 36), s, fill=TEXT, font=f_sm)

    img.save(path, quality=95)


def diagram_finance(path: Path):
    w, h = 1600, 700
    img = Image.new("RGB", (w, h), BG)
    d = ImageDraw.Draw(img)
    f_title = font(32, True)
    f = font(24)
    f_sm = font(18)
    d.text((48, 30), "ORÇAMENTO ESTIMADO (R$ 1.000)", fill=ACCENT, font=f_title)

    # bars
    items = [
        ("Tablet TCL Tab 10L Gen 4", 800, ACCENT),
        ("Kit pulseira (1 + placa reserva)", 165, BLUE),
        ("Caixa 3D + velcro", 20, GREEN),
        ("Margem / frete", 15, MUTED),
    ]
    max_v = 1000
    y = 120
    for name, val, color in items:
        d.text((48, y), name, fill=TEXT, font=f_sm)
        bw = int(1100 * val / max_v)
        rounded(d, (520, y, 520 + bw, y + 36), color, 8)
        d.text((540 + bw, y + 4), f"R$ {val}", fill=TEXT, font=f_sm)
        y += 70

    rounded(d, (48, 480, 1550, 640), PANEL, 16)
    d.text((80, 510), "Total estimado ≈ R$ 1.000", fill=ACCENT, font=f_title)
    d.text((80, 570), "Sem tomada · sem base · sem sensor de pressão · 1 pulseira + 1 placa reserva", fill=MUTED, font=f)
    img.save(path, quality=95)


def diagram_flow(path: Path):
    w, h = 1600, 500
    img = Image.new("RGB", (w, h), BG)
    d = ImageDraw.Draw(img)
    f = font(22, True)
    f_sm = font(18)
    boxes = [
        (60, "Cadastro\nequipes", MUTED),
        (360, "PRONTO\nno tablet", BLUE),
        (660, "Bipe na\npulseira", ORANGE),
        (960, "Braço\nlevantado", GREEN),
        (1260, "Ranking +\nvídeo", ACCENT),
    ]
    for x, label, color in boxes:
        rounded(d, (x, 140, x + 240, 320), PANEL, 16)
        d.rectangle((x, 140, x + 240, 152), fill=color)
        lines = label.split("\n")
        for i, line in enumerate(lines):
            d.text((x + 40, 200 + i * 36), line, fill=TEXT, font=f)
    for x in (300, 600, 900, 1200):
        d.polygon([(x, 220), (x + 40, 240), (x, 260)], fill=ACCENT)
    d.text((48, 40), "FLUXO DO TREINO (SEM ENGENHARIA NO BOX)", fill=ACCENT, font=font(28, True))
    d.text((48, 400), "Estagiário monta tablet + pulseira · mecânicos treinam sozinhos · engenharia só vê o ranking no fim do dia", fill=MUTED, font=f_sm)
    img.save(path, quality=95)


# ---------- PPTX ----------
def rgb(c):
    return RGBColor(*c)


def set_run(run, size=18, bold=False, color=TEXT):
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = rgb(color)
    run.font.name = "Segoe UI"


def add_bg(slide, color=BG):
    fill = slide.background.fill
    fill.solid()
    fill.fore_color.rgb = rgb(color)


def box(slide, l, t, w, h, fill=PANEL, line=None):
    sh = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, l, t, w, h)
    sh.fill.solid()
    sh.fill.fore_color.rgb = rgb(fill)
    sh.line.fill.background()
    if line:
        sh.line.color.rgb = rgb(line)
        sh.line.width = Pt(1.5)
    # roundness
    try:
        sh.adjustments[0] = 0.1
    except Exception:
        pass
    return sh


def textbox(slide, l, t, w, h, text, size=18, bold=False, color=TEXT, align=PP_ALIGN.LEFT):
    tb = slide.shapes.add_textbox(l, t, w, h)
    tf = tb.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.alignment = align
    run = p.add_run()
    run.text = text
    set_run(run, size, bold, color)
    return tb


def add_bullets(slide, l, t, w, h, items, size=16):
    tb = slide.shapes.add_textbox(l, t, w, h)
    tf = tb.text_frame
    tf.word_wrap = True
    for i, item in enumerate(items):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.level = 0
        p.space_after = Pt(8)
        run = p.add_run()
        run.text = "•  " + item
        set_run(run, size, False, TEXT)
    return tb


def build_pptx():
    diagram_overview(ASSETS / "diagrama_sistema.png")
    diagram_finance(ASSETS / "orcamento.png")
    diagram_flow(ASSETS / "fluxo.png")

    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)

    # 1 capa
    s = prs.slides.add_slide(prs.slide_layouts[6])
    add_bg(s)
    box(s, Inches(0), Inches(0), Inches(13.333), Inches(0.15), ACCENT)
    textbox(s, Inches(0.8), Inches(2.2), Inches(11.5), Inches(1),
            "PIT STOP · CRONOMETRAGEM AUTOMATIZADA", 36, True, ACCENT)
    textbox(s, Inches(0.8), Inches(3.3), Inches(11.5), Inches(1),
            "Sistema de treino em tempo real com ranking diário e premiação", 22, False, TEXT)
    textbox(s, Inches(0.8), Inches(5.8), Inches(11.5), Inches(0.5),
            "Proposta técnica e comercial  ·  Orçamento R$ 1.000  ·  Departamento de Engenharia", 14, False, MUTED)

    # 2 problema
    s = prs.slides.add_slide(prs.slide_layouts[6])
    add_bg(s)
    textbox(s, Inches(0.6), Inches(0.35), Inches(12), Inches(0.6), "O problema", 28, True, ACCENT)
    cards = [
        ("Hoje", "Cronometragem manual\nEngenharia fica a tarde\ninteira no box\nErro humano ±0,2 s"),
        ("Objetivo", "Treino sem operador\nRanking ao vivo\nPremiar o mais rápido\nno fim do dia"),
        ("Restrições", "Descampado sem tomada\nOrçamento R$ 1.000\nSetup fácil (~2 min)\nUso pelos mecânicos"),
    ]
    for i, (title, body) in enumerate(cards):
        x = Inches(0.6 + i * 4.2)
        box(s, x, Inches(1.3), Inches(3.9), Inches(5.2), PANEL)
        textbox(s, x + Inches(0.25), Inches(1.55), Inches(3.4), Inches(0.5), title, 22, True, ACCENT)
        textbox(s, x + Inches(0.25), Inches(2.3), Inches(3.4), Inches(3.8), body, 18, False, TEXT)

    # 3 solução
    s = prs.slides.add_slide(prs.slide_layouts[6])
    add_bg(s)
    textbox(s, Inches(0.6), Inches(0.3), Inches(12), Inches(0.5), "A solução: tablet + pulseira", 28, True, ACCENT)
    s.shapes.add_picture(str(ASSETS / "diagrama_sistema.png"), Inches(0.4), Inches(0.9), width=Inches(12.5))

    # 4 como funciona
    s = prs.slides.add_slide(prs.slide_layouts[6])
    add_bg(s)
    textbox(s, Inches(0.6), Inches(0.3), Inches(12), Inches(0.5), "Como funciona no treino", 28, True, ACCENT)
    s.shapes.add_picture(str(ASSETS / "fluxo.png"), Inches(0.4), Inches(1.0), width=Inches(12.5))
    add_bullets(s, Inches(0.8), Inches(5.5), Inches(11.5), Inches(1.6), [
        "Tipo 1 (1 pneu, ~3 s): pistoleiro + encaixador  ·  Tipo 2 (2 pneus, ~7 s): pistoleiro + 1 ou 2 encaixadores",
        "Largada por bipe aleatório (1,5–3,5 s)  ·  Fim quando o pistoleiro levanta o braço livre",
        "Tablet filma a sessão e corta automaticamente o vídeo de cada tentativa para a premiação",
    ], 15)

    # 5 por que pulseira
    s = prs.slides.add_slide(prs.slide_layouts[6])
    add_bg(s)
    textbox(s, Inches(0.6), Inches(0.3), Inches(12), Inches(0.5), "Por que pulseira (e não só câmera)?", 28, True, ACCENT)
    left = [
        "Precisão de milissegundos (relógio na pulseira)",
        "Imune a luz, sombra e gente passando",
        "Sem tripé / calibração de câmera todo dia",
        "Funciona no descampado, 100% a bateria",
        "Bluetooth LE + reenvio: falha de conexão não perde tempo",
        "Botão de reserva se o tablet falhar",
    ]
    right = [
        "Câmera / GoPro: opcional, só para evidência e vídeo",
        "Não cronometra — o tempo oficial é da pulseira",
        "App de câmera já existe como modo reserva",
        "Pulseira no braço LIVRE (oposto à pistola)",
        "Montagem: ligar tablet + colocar pulseira",
        "Caixa 3D + velcro (temos experiência)",
    ]
    box(s, Inches(0.5), Inches(1.1), Inches(6), Inches(5.8), PANEL)
    textbox(s, Inches(0.75), Inches(1.3), Inches(5.5), Inches(0.4), "Vantagens", 18, True, GREEN)
    add_bullets(s, Inches(0.75), Inches(1.9), Inches(5.5), Inches(4.8), left, 15)
    box(s, Inches(6.8), Inches(1.1), Inches(6), Inches(5.8), PANEL)
    textbox(s, Inches(7.05), Inches(1.3), Inches(5.5), Inches(0.4), "Complementos / decisões", 18, True, BLUE)
    add_bullets(s, Inches(7.05), Inches(1.9), Inches(5.5), Inches(4.8), right, 15)

    # 6 comercial
    s = prs.slides.add_slide(prs.slide_layouts[6])
    add_bg(s)
    textbox(s, Inches(0.6), Inches(0.25), Inches(12), Inches(0.5), "Comercial e financeiro", 28, True, ACCENT)
    s.shapes.add_picture(str(ASSETS / "orcamento.png"), Inches(0.5), Inches(0.9), width=Inches(12.3))

    # 7 lista compras
    s = prs.slides.add_slide(prs.slide_layouts[6])
    add_bg(s)
    textbox(s, Inches(0.6), Inches(0.3), Inches(12), Inches(0.5), "O que comprar (Mercado Livre)", 28, True, ACCENT)

    rows = [
        ["Qtd", "Item", "Função", "Est. R$"],
        ["1", "Tablet TCL Tab 10L Gen 4 (128 GB)", "Tela, ranking, vídeo", "700–900"],
        ["2", "ESP32-C3 Super/Pro Mini", "Pulseira + reserva", "80"],
        ["1", "MPU6050 GY-521", "Detecta braço levantado", "20"],
        ["1", "LiPo 3,7 V 500 mAh", "Bateria da pulseira (8–12 h)", "30"],
        ["1", "TP4056 USB-C", "Carregamento", "10"],
        ["2", "Buzzer ativo 3–5 V 12 mm", "Bipe de largada", "10"],
        ["1", "Pulseira velcro + botão + LED", "Montagem / status", "25"],
    ]
    table = s.shapes.add_table(len(rows), 4, Inches(0.5), Inches(1.0), Inches(12.3), Inches(5.5)).table
    widths = [Inches(0.8), Inches(5.5), Inches(4.2), Inches(1.8)]
    for i, w in enumerate(widths):
        table.columns[i].width = w
    for r, row in enumerate(rows):
        for c, val in enumerate(row):
            cell = table.cell(r, c)
            cell.text = val
            for p in cell.text_frame.paragraphs:
                p.alignment = PP_ALIGN.LEFT if c else PP_ALIGN.CENTER
                for run in p.runs:
                    set_run(run, 13, bold=(r == 0), color=ACCENT if r == 0 else TEXT)
            # fill
            cell.fill.solid()
            cell.fill.fore_color.rgb = rgb(PANEL if r % 2 == 0 else PANEL2)

    # 8 ROI / ganhos
    s = prs.slides.add_slide(prs.slide_layouts[6])
    add_bg(s)
    textbox(s, Inches(0.6), Inches(0.3), Inches(12), Inches(0.5), "Retorno esperado", 28, True, ACCENT)
    gains = [
        ("Tempo da engenharia", "Libera a tarde no box.\nEstagiário só monta e recolhe."),
        ("Justiça na premiação", "Tempo objetivo + vídeo\ndo pit vencedor."),
        ("Dados históricos", "Média, melhor tempo e\nevolução por mecânico."),
        ("Escalável", "Firmware + app prontos.\n2ª pulseira barata se precisar."),
    ]
    for i, (t, b) in enumerate(gains):
        x = Inches(0.5 + (i % 2) * 6.4)
        y = Inches(1.2 + (i // 2) * 2.9)
        box(s, x, y, Inches(6.0), Inches(2.6), PANEL)
        textbox(s, x + Inches(0.3), y + Inches(0.3), Inches(5.4), Inches(0.5), t, 20, True, ACCENT)
        textbox(s, x + Inches(0.3), y + Inches(1.0), Inches(5.4), Inches(1.3), b, 16, False, TEXT)

    # 9 próximos passos
    s = prs.slides.add_slide(prs.slide_layouts[6])
    add_bg(s)
    textbox(s, Inches(0.6), Inches(0.3), Inches(12), Inches(0.5), "Próximos passos", 28, True, ACCENT)
    steps = [
        ("1", "Aprovar orçamento e comprar o kit (tablet + eletrônica)"),
        ("2", "Eletrônica monta e imprime a caixa da pulseira (PDF técnico anexo)"),
        ("3", "Gravar firmware + integrar app do tablet à pulseira"),
        ("4", "Teste no box com 10–20 tentativas e ajuste fino"),
        ("5", "Treino oficial com ranking e premiação do dia"),
    ]
    for i, (n, txt) in enumerate(steps):
        y = Inches(1.2 + i * 1.05)
        circ = s.shapes.add_shape(MSO_SHAPE.OVAL, Inches(0.8), y, Inches(0.7), Inches(0.7))
        circ.fill.solid()
        circ.fill.fore_color.rgb = rgb(ACCENT)
        circ.line.fill.background()
        textbox(s, Inches(0.9), y + Inches(0.12), Inches(0.5), Inches(0.5), n, 22, True, BLACK, PP_ALIGN.CENTER)
        box(s, Inches(1.8), y, Inches(10.5), Inches(0.85), PANEL)
        textbox(s, Inches(2.1), y + Inches(0.2), Inches(10), Inches(0.5), txt, 18, False, TEXT)

    # 10 fechamento
    s = prs.slides.add_slide(prs.slide_layouts[6])
    add_bg(s)
    box(s, Inches(0), Inches(0), Inches(13.333), Inches(0.15), ACCENT)
    textbox(s, Inches(0.8), Inches(2.5), Inches(11.5), Inches(1),
            "Perguntas?", 40, True, ACCENT, PP_ALIGN.CENTER)
    textbox(s, Inches(0.8), Inches(3.8), Inches(11.5), Inches(1),
            "Documento técnico para a eletrônica acompanha esta proposta.", 18, False, MUTED, PP_ALIGN.CENTER)

    out = ROOT / "Apresentacao_PitStop_Cronometragem.pptx"
    prs.save(out)
    return out


# ---------- PDF eletrônica ----------
def build_pdf():
    """Memo técnico para o time de eletrônica — tabelas só com Paragraph, sem overlap."""
    out = ROOT / "Especificacao_Eletronica_Pulseira.pdf"

    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(
        name="DocTitle", fontName="Helvetica-Bold", fontSize=13,
        textColor=colors.HexColor("#1a1a1a"), leading=16, spaceAfter=2,
    ))
    styles.add(ParagraphStyle(
        name="Meta", fontName="Helvetica", fontSize=8.5,
        textColor=colors.HexColor("#555555"), leading=11, spaceAfter=8,
    ))
    styles.add(ParagraphStyle(
        name="Sec", fontName="Helvetica-Bold", fontSize=10.5,
        textColor=colors.HexColor("#1a1a1a"), spaceBefore=12, spaceAfter=5, leading=13,
    ))
    styles.add(ParagraphStyle(
        name="Body", fontName="Helvetica", fontSize=9,
        textColor=colors.HexColor("#222222"), alignment=TA_JUSTIFY, leading=12, spaceAfter=5,
    ))
    styles.add(ParagraphStyle(
        name="BulletBody", fontName="Helvetica", fontSize=9,
        textColor=colors.HexColor("#222222"), leading=12, leftIndent=0,
    ))
    styles.add(ParagraphStyle(
        name="CmdLine", fontName="Courier", fontSize=8,
        textColor=colors.HexColor("#1a1a1a"), leading=10, spaceBefore=2, spaceAfter=2,
        leftIndent=8,
    ))
    styles.add(ParagraphStyle(
        name="Small", fontName="Helvetica", fontSize=8,
        textColor=colors.HexColor("#555555"), leading=10, spaceAfter=4,
    ))
    styles.add(ParagraphStyle(
        name="Th", fontName="Helvetica-Bold", fontSize=8,
        textColor=colors.HexColor("#1a1a1a"), leading=10,
    ))
    styles.add(ParagraphStyle(
        name="Td", fontName="Helvetica", fontSize=8,
        textColor=colors.HexColor("#222222"), leading=10,
    ))
    styles.add(ParagraphStyle(
        name="TdC", fontName="Helvetica", fontSize=8,
        textColor=colors.HexColor("#222222"), leading=10, alignment=TA_CENTER,
    ))

    def th(txt):
        return Paragraph(txt, styles["Th"])

    def td(txt, center=False):
        return Paragraph(txt, styles["TdC"] if center else styles["Td"])

    def section(num, title):
        return Paragraph(f"{num}. {title}", styles["Sec"])

    def bullets(items):
        return ListFlowable(
            [ListItem(Paragraph(x, styles["BulletBody"]), leftIndent=8, bulletColor=colors.HexColor("#333333"))
             for x in items],
            bulletType="bullet", start="•", leftIndent=14, bulletFontSize=8, spaceBefore=0, spaceAfter=4,
        )

    def tabela(dados, col_widths):
        """Todas as células são Paragraph; evita texto sobreposto."""
        t = Table(dados, colWidths=col_widths, repeatRows=1)
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E8E8E8")),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#999999")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F7F7F7")]),
        ]))
        return t

    def footer(canvas, doc_):
        canvas.saveState()
        canvas.setStrokeColor(colors.HexColor("#CCCCCC"))
        canvas.setLineWidth(0.4)
        canvas.line(1.8 * cm, 1.3 * cm, A4[0] - 1.8 * cm, 1.3 * cm)
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(colors.HexColor("#666666"))
        canvas.drawString(1.8 * cm, 0.85 * cm, "Pit Stop — pulseira  |  ENG → Eletrônica  |  confidencial interno")
        canvas.drawRightString(A4[0] - 1.8 * cm, 0.85 * cm, f"pág. {doc_.page}")
        canvas.restoreState()

    story = []

    # Cabeçalho estilo memo interno
    head = Table(
        [[
            Paragraph("<b>ENGENHARIA</b><br/>Pit Stop — cronometragem", styles["Td"]),
            Paragraph("<b>Para:</b> Elétrica / Eletrônica<br/><b>De:</b> Engenharia<br/><b>Assunto:</b> Montagem da pulseira", styles["Td"]),
            Paragraph("<b>Ref:</b> PS-PUL-001<br/><b>Data:</b> 25/11/2026<br/><b>Rev:</b> A", styles["Td"]),
        ]],
        colWidths=[5.5 * cm, 6.5 * cm, 4.4 * cm],
    )
    head.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#333333")),
        ("LINEAFTER", (0, 0), (1, 0), 0.5, colors.HexColor("#999999")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("BACKGROUND", (0, 0), (0, 0), colors.HexColor("#F5F5F5")),
    ]))
    story.append(head)
    story.append(Spacer(1, 10))
    story.append(Paragraph("Especificação de hardware — pulseira de cronometragem", styles["DocTitle"]))
    story.append(Paragraph(
        "Uma unidade montada + uma placa ESP32-C3 de reserva. Alimentação só a bateria (descampado, sem tomada). "
        "Firmware já existe em firmware/pulseira/pulseira.ino.",
        styles["Meta"],
    ))

    story.append(section("1", "O que precisa sair da bancada"))
    story.append(Paragraph(
        "Uma pulseira no braço livre do pistoleiro (o braço que ele levanta no fim do pit — não o da pistola). "
        "Ela apita a largada, mede o tempo com o acelerômetro e manda o resultado ao tablet por Bluetooth LE. "
        "Não entra no escopo de vocês: app do tablet, ranking nem vídeo.",
        styles["Body"],
    ))
    story.append(bullets([
        "Projeto e impressão 3D da caixa (PETG ou ABS).",
        "Soldagem / montagem conforme pinagem abaixo.",
        "Gravação do firmware e calibração do “braço para cima”.",
        "Entrega: 1 pulseira ok + 1 C3 reserva + STL/STEP + foto da montagem.",
    ]))

    story.append(section("2", "Como a peça se comporta"))
    story.append(Paragraph(
        "Tablet manda PRONTO → pulseira espera 1,5 a 3,5 s (aleatório) → bipe = t0. "
        "Braço livre parado “para cima” por pelo menos 100 ms (depois dos primeiros 1,5 s) = t1. "
        "Tempo enviado = t1 − t0. Se o BLE cair no meio, o resultado fica na memória e reenvia até o tablet confirmar. "
        "Botão curto arma/cancela sem tablet; botão longo (≥2 s) calibra.",
        styles["Body"],
    ))

    story.append(section("3", "Lista de materiais"))
    bom_rows = [
        [th("Qtd"), th("Item"), th("Especificação"), th("Nota")],
        [td("2", True), td("ESP32-C3 Super Mini ou Pro Mini"), td("USB-C, BLE"), td("1 uso + 1 reserva")],
        [td("1", True), td("MPU6050 (módulo GY-521)"), td("I²C, 3,3 V"), td("Acelerômetro")],
        [td("1", True), td("LiPo 3,7 V"), td("500 mAh (JST se tiver)"), td("Meta: ≥8 h de uso")],
        [td("1", True), td("TP4056"), td("USB-C + proteção de descarga"), td("Carga da LiPo")],
        [td("2", True), td("Buzzer ativo"), td("3–5 V, Ø12 mm, ≥85 dB"), td("1 reserva")],
        [td("1", True), td("NPN BC547 ou 2N2222"), td("+ resistor 1 kΩ na base"), td("Driver do buzzer")],
        [td("1", True), td("Botão tátil 6×6 mm"), td("NA"), td("GPIO4 ↔ GND")],
        [td("1", True), td("LED 3 mm + 330 Ω"), td("Qualquer cor"), td("Status")],
        [td("2", True), td("Resistor 100 kΩ"), td("Divisor 1:1"), td("Leitura de bateria")],
        [td("1", True), td("Velcro elástico"), td("Largura 25–30 mm"), td("Fixação no antebraço")],
        [td("—", True), td("Fio AWG 28/30, solda, termorretrátil"), td("—"), td("Montagem")],
        [td("—", True), td("Caixa impressa"), td("PETG / ABS"), td("Feita aí")],
    ]
    story.append(tabela(bom_rows, [1.3 * cm, 5.8 * cm, 4.8 * cm, 4.5 * cm]))
    story.append(Spacer(1, 4))
    story.append(Paragraph(
        "Fora da compra: ESP32-S3, sensor de pressão, engate de ar, power bank, cronômetro de parede.",
        styles["Small"],
    ))

    story.append(section("4", "Ligações (ESP32-C3)"))
    story.append(Paragraph(
        "Arduino IDE / arduino-cli: placa <b>ESP32C3 Dev Module</b>, USB CDC On Boot = Enabled.",
        styles["Body"],
    ))
    pin_rows = [
        [th("Função"), th("GPIO"), th("Como ligar")],
        [td("MPU SDA"), td("5", True), td("GY-521: VCC→3V3, GND→GND, SDA→GPIO5")],
        [td("MPU SCL"), td("6", True), td("SCL→GPIO6")],
        [td("Buzzer"), td("3", True), td("GPIO3 → 1 kΩ → base NPN; emissor→GND; coletor→(−) buzzer; (+) buzzer→BAT+")],
        [td("Botão"), td("4", True), td("Botão entre GPIO4 e GND (pull-up interno)")],
        [td("LED"), td("7", True), td("GPIO7 → 330 Ω → LED → GND")],
        [td("ADC bateria"), td("0", True), td("BAT+ — 100 kΩ — GPIO0 — 100 kΩ — GND")],
    ]
    story.append(tabela(pin_rows, [3.2 * cm, 1.6 * cm, 11.6 * cm]))
    story.append(Spacer(1, 4))
    story.append(Paragraph(
        "Não ligar o buzzer direto no GPIO. O NPN é obrigatório.",
        styles["Small"],
    ))

    story.append(section("5", "Firmware"))
    story.append(Paragraph(
        "Arquivo: firmware/pulseira/pulseira.ino. Nome BLE anunciado: <b>PitStop-Pulseira</b>. "
        "UUIDs do serviço/características estão no topo do .ino.",
        styles["Body"],
    ))
    story.append(Paragraph("arduino-cli compile --fqbn esp32:esp32:esp32c3 firmware/pulseira", styles["CmdLine"]))
    story.append(Paragraph("arduino-cli upload -p COMx --fqbn esp32:esp32:esp32c3 firmware/pulseira", styles["CmdLine"]))
    story.append(Spacer(1, 4))
    story.append(Paragraph(
        "Depois de gravar: colocar a pulseira no antebraço na postura final do pit (braço levantado) e segurar o botão ≥2 s para calibrar. "
        "Dois bipes curtos = calibração ok.",
        styles["Body"],
    ))

    story.append(section("6", "Caixa 3D"))
    story.append(bullets([
        "Cabe: C3 + GY-521 + TP4056 + LiPo 500 mAh + buzzer Ø12 mm.",
        "USB-C de carga acessível sem abrir.",
        "Saída de som na frente do buzzer (grade ou furo).",
        "Botão e LED usáveis com a outra mão.",
        "Passagem / trava para velcro 25–30 mm — a caixa não pode girar no braço.",
        "MPU6050 fixo na caixa (orientação constante); a calibração assume isso.",
        "Material: PETG ou ABS. PLA só para protótipo.",
    ]))

    story.append(section("7", "Checklist antes de devolver"))
    story.append(bullets([
        "Carrega via USB-C; não esquenta demais; ≥8 h ligados com BLE.",
        "Buzzer ouve-se a pelo menos 5 m ao ar livre.",
        "Clique curto: arma / cancela. Clique longo: calibra.",
        "LED: piscando = procurando / armado; fixo = conectado e calibrado (ver .ino).",
        "50 ciclos de bipe → braço para cima sem travar.",
        "Desligar o tablet no meio: ao reconectar, tempos pendentes reaparecem.",
        "Queda de ~1 m com caixa fechada: continua funcionando.",
    ]))

    story.append(section("8", "LiPo"))
    story.append(Paragraph(
        "Usar TP4056 com proteção. Não furar a célula. Primeira carga com supervisão. "
        "Soldas isoladas com termorretrátil.",
        styles["Body"],
    ))

    story.append(section("9", "Entrega"))
    story.append(Paragraph(
        "Pulseira montada, cabo USB-C, C3 reserva, arquivo da caixa (STL ou STEP) e uma foto da pinagem real. "
        "Dúvida de protocolo BLE ou app: falar com Engenharia (repo pitstop-cronometro).",
        styles["Body"],
    ))

    doc = SimpleDocTemplate(
        str(out), pagesize=A4,
        leftMargin=1.8 * cm, rightMargin=1.8 * cm,
        topMargin=1.5 * cm, bottomMargin=1.8 * cm,
        title="PS-PUL-001 Pulseira Pit Stop",
        author="Engenharia",
    )
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return out


if __name__ == "__main__":
    pptx_path = build_pptx()
    pdf_path = build_pdf()
    print(pptx_path)
    print(pdf_path)
