#!/usr/bin/env python3
"""
Quinto Chat - gerador do catálogo
Lê o feed XML do ImobiBrasil e grava um catalogo.json enxuto que o agente consulta.

Uso:
  python gerar_catalogo.py --feed "URL_OU_ARQUIVO" --saida catalogo.json
  python gerar_catalogo.py --feed "URL_OU_ARQUIVO" --inspecionar

--inspecionar mostra os campos do primeiro imóvel e como cada um foi mapeado.
Se algum campo vier vazio, acrescente o nome da tag do seu feed em SINONIMOS.

Desde a versão 2.0, o feed é só o ponto de partida: o gerador também lê a listagem de
imóveis do próprio site e acrescenta os que o feed não traz (o feed de portal costuma vir
incompleto). Também guarda um resumo das páginas e dos artigos do site ("paginas"), para o
agente responder sobre o conteúdo do site. Se o site não responder, vale só o feed.

  --sem-site   não lê o site (só o feed)

Sem dependências externas (só a biblioteca padrão do Python).
"""

import argparse
import html
import json
import os
import re
import sys
import time
import unicodedata
import urllib.request
import xml.etree.ElementTree as ET
from collections import Counter
from datetime import date, datetime, timedelta, timezone

SITE = "https://www.quintoimoveis.com.br"

# Nome da tag no feed (minúsculo, sem _ ou -) -> campo do catálogo.
# A primeira tag encontrada na lista vence.
SINONIMOS = {
    "id": ["idimovel", "imovelid", "id", "listingid", "codigointerno"],
    "codigo": ["referencia", "codigoreferencia", "ref", "codigo", "codigoimovel", "reference", "listingid"],
    "tipo": ["subtipo", "tipoimovel", "tipo", "propertytype", "categoria"],
    "finalidade": ["finalidade", "transactiontype", "negocio", "transacao"],
    "bairro": ["bairro", "neighborhood"],
    "cidade": ["cidade", "city", "municipio"],
    "endereco": ["endereco", "logradouro", "rua", "address"],
    "preco": ["valorvenda", "precovenda", "valor", "preco", "listprice", "price"],
    "quartos": ["dormitorios", "quartos", "dormitorio", "bedrooms", "qtddormitorios"],
    "suites": ["suites", "suite", "qtdsuites"],
    "banheiros": ["banheiros", "banheiro", "bathrooms", "qtdbanheiros"],
    "vagas": ["vagas", "vagasgaragem", "garagem", "garage", "qtdvagas"],
    "area": ["areautil", "areaprivativa", "livingarea", "areaconstruida", "area", "areatotal", "lotarea"],
    "condominio": ["valorcondominio", "condominio", "propertyadministrationfee"],
    "iptu": ["valoriptu", "iptu", "yearlytax"],
    "titulo": ["tituloanuncio", "titulo", "title", "titulosite"],
    "descricao": ["descricao", "description", "descricaoimovel", "observacao"],
    "url": ["urlimovel", "url", "link", "detailviewurl", "linkimovel"],
    "ativo": ["ativo", "status", "situacao", "publicado"],
}

# Tags cujos filhos são características (varanda, piscina, portaria 24h...)
TAGS_CARACTERISTICAS = ("caracteristic", "feature", "infraestrutura", "comodidade", "diferencia", "lazer")

INATIVO = {"0", "false", "nao", "não", "inativo", "vendido", "suspenso", "excluido", "excluído", "n"}
SIM = {"1", "sim", "true", "s", "yes"}

RE_IMAGEM = re.compile(r"https?://\S+\.(jpe?g|png|webp|gif)(\?\S*)?$", re.I)

# Feeds no padrão VRSync (ZAP/VivaReal) vêm em inglês
TRADUCAO = {
    "apartment": "Apartamento", "home": "Casa", "house": "Casa", "penthouse": "Cobertura",
    "condo": "Casa em condomínio", "sobrado": "Casa duplex", "flat": "Flat", "kitnet": "Kitnet",
    "office": "Sala comercial", "commercial building": "Prédio comercial", "land lot": "Terreno",
    "residential building": "Prédio residencial", "farm ranch": "Sítio", "studio": "Studio",
    "for sale": "Venda", "for rent": "Locação", "sale/rent": "Venda e locação",
    "balcony": "Varanda", "pool": "Piscina", "elevator": "Elevador", "gym": "Academia",
    "barbecue grill": "Churrasqueira", "gated community": "Condomínio fechado", "sauna": "Sauna",
    "playground": "Playground", "party room": "Salão de festas", "sports court": "Quadra",
    "intercom": "Interfone", "furnished": "Mobiliado", "air conditioning": "Ar-condicionado",
    "security guard on duty": "Portaria 24h", "24 hour security": "Segurança 24h",
    "service area": "Área de serviço", "garden area": "Jardim", "ocean view": "Vista mar",
    "pets allowed": "Aceita pet", "american kitchen": "Cozinha americana",
    # características vistas no feed do ImobiBrasil (VRSync)
    "adult pool": "Piscina adulto", "bbq": "Churrasqueira", "close to schools": "Perto de escolas",
    "close to shopping centers": "Perto de shopping", "cooling": "Ar-condicionado",
    "dinner room": "Sala de jantar", "fenced yard": "Área cercada", "game room": "Salão de jogos",
    "gourmet area": "Espaço gourmet", "gourmet balcony": "Varanda gourmet", "indoor soccer": "Quadra de futsal",
    "kitchen": "Cozinha", "maid's quarters": "Dependência de empregada", "massage room": "Sala de massagem",
    "spa": "Spa", "toys place": "Brinquedoteca", "veranda": "Varanda", "concierge 24h": "Portaria 24h",
    "closet": "Closet", "copa": "Copa", "laundry": "Lavanderia", "fireplace": "Lareira",
    "heated pool": "Piscina aquecida", "kids pool": "Piscina infantil", "tennis court": "Quadra de tênis",
    "sports area": "Área esportiva", "cinema": "Cinema", "coworking": "Coworking", "deck": "Deck",
    "garden": "Jardim", "private pool": "Piscina privativa", "storage": "Depósito",
    "wine cellar": "Adega", "solarium": "Solário", "bicycles place": "Bicicletário",
}


def traduzir(texto):
    if not texto:
        return texto
    ultimo = texto.split("/")[-1].strip()
    return TRADUCAO.get(ultimo.lower(), TRADUCAO.get(texto.strip().lower(), texto.strip()))


def corrigir_codificacao(texto):
    """Conserta 'IcaraÃ­' -> 'Icaraí' (UTF-8 lido como Latin-1)."""
    if re.search(r"[ÃÂ][\x80-\xbf]", texto):
        try:
            return texto.encode("latin-1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            pass
    return texto

LIMITE_DESCRICAO = 1500


def chave(tag):
    """Remove namespace, acentos, _ e - e deixa minúsculo."""
    tag = tag.split("}")[-1]
    tag = unicodedata.normalize("NFKD", tag).encode("ascii", "ignore").decode()
    return re.sub(r"[_\-\s]", "", tag).lower()


def slug(texto):
    texto = unicodedata.normalize("NFKD", texto or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", texto).strip("-")


def limpar_texto(texto):
    if not texto:
        return ""
    texto = corrigir_codificacao(html.unescape(texto))
    texto = re.sub(r"<br\s*/?>|</p>", "\n", texto, flags=re.I)
    texto = re.sub(r"<[^>]+>", " ", texto)
    texto = html.unescape(texto)
    # entidade que perdeu o "&" no caminho: "D#39;Or" -> "D'Or"
    texto = re.sub(r"(?<!&)#(\d{2,4});", lambda m: chr(int(m.group(1))), texto)
    texto = re.sub(r"[ \t\r\f\v]+", " ", texto)
    texto = re.sub(r"\n\s*\n+", "\n", texto)
    return texto.strip()


def numero(texto):
    """'850.000,00' / '850000.00' / 'R$ 850.000' / '850000' -> 850000.0"""
    if texto is None:
        return None
    s = re.sub(r"[^0-9,.]", "", str(texto))
    if not s:
        return None
    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        partes = s.split(",")
        s = s.replace(",", ".") if len(partes) == 2 and len(partes[1]) != 3 else s.replace(",", "")
    elif s.count(".") > 1 or (s.count(".") == 1 and len(s.split(".")[1]) == 3):
        s = s.replace(".", "")
    try:
        return float(s)
    except ValueError:
        return None


def inteiro(texto):
    n = numero(texto)
    return int(n) if n is not None else None


def carregar_feed(origem):
    if re.match(r"https?://", origem):
        req = urllib.request.Request(origem, headers={"User-Agent": "QuintoChat-Catalogo/1.0"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.read()
    with open(origem, "rb") as f:
        return f.read()


def achar_imoveis(raiz):
    """O elemento que mais se repete e tem filhos é o 'imóvel' do feed."""
    contagem = Counter()
    for el in raiz.iter():
        if len(el):
            contagem[el.tag] += 1
    candidatos = []
    for tag, qtd in contagem.most_common(10):
        exemplo = next(raiz.iter(tag))
        chaves = {chave(e.tag) for e in exemplo.iter()}
        pontos = sum(1 for lista in (SINONIMOS["preco"], SINONIMOS["bairro"], SINONIMOS["codigo"]) if chaves & set(lista))
        candidatos.append((pontos, qtd, tag))
    candidatos.sort(reverse=True)
    if not candidatos or candidatos[0][0] == 0:
        return []
    return list(raiz.iter(candidatos[0][2]))


def achatar(imovel):
    """Mapa {tag normalizada: texto} com as folhas do imóvel (primeira ocorrência vence)."""
    campos, caracteristicas, fotos = {}, [], []

    def visitar(el, dentro_carac):
        k = chave(el.tag)
        carac = dentro_carac or any(t in k for t in TAGS_CARACTERISTICAS)
        texto = (el.text or "").strip()
        if len(el) == 0:
            if texto:
                imagem = bool(RE_IMAGEM.match(texto))
                if imagem:
                    fotos.append((el.attrib.get("primary") == "true", texto))
                elif carac and k not in SINONIMOS["descricao"]:
                    if texto.lower() in SIM:  # <varanda>1</varanda> -> "Varanda"
                        caracteristicas.append(el.tag.split("}")[-1].replace("_", " ").capitalize())
                    elif texto.lower() not in INATIVO:  # <piscina>0</piscina> -> ignora
                        caracteristicas.append(traduzir(texto))
                # links de foto não entram no mapa de campos (não podem virar "url" do imóvel)
                if not imagem:
                    campos.setdefault(k, texto)
            # atributos também contam (ex.: <Price currency="BRL">)
            for ak, av in el.attrib.items():
                campos.setdefault(k + chave(ak), av)
        else:
            for filho in el:
                visitar(filho, carac)

    for filho in imovel:
        visitar(filho, False)
    for ak, av in imovel.attrib.items():
        campos.setdefault(chave(ak), av)
    fotos.sort(key=lambda f: not f[0])
    return campos, caracteristicas, [f[1] for f in fotos]


def pegar(campos, nome):
    for k in SINONIMOS[nome]:
        if campos.get(k):
            return campos[k], k
    return None, None


def montar(imovel):
    campos, caracteristicas, fotos = achatar(imovel)
    v = {nome: pegar(campos, nome)[0] for nome in SINONIMOS}

    ativo = (v["ativo"] or "").strip().lower()
    if ativo in INATIVO:
        return None

    # ImobiBrasil (VRSync): ListingID vem como "QI1546_1-3838693" = código + "_1-" + id do site
    bruto = (v["codigo"] or v["id"] or "").strip()
    m_id = re.match(r"^([A-Za-z]+\d+)_\d+-(\d+)$", bruto)
    codigo_limpo = m_id.group(1) if m_id else bruto
    id_limpo = (v["id"] or "").strip()
    if m_id and (not id_limpo or id_limpo == bruto):
        id_limpo = m_id.group(2)

    tipo = traduzir(limpar_texto(v["tipo"])) or "Imóvel"
    bairro = limpar_texto(v["bairro"])
    cidade = limpar_texto(v["cidade"]) or "Niterói"
    url = (v["url"] or "").strip()
    if not url.startswith("http") and id_limpo:
        url = f"{SITE}/imovel/{id_limpo}/{slug(tipo)}-venda-{slug(cidade)}-rj-{slug(bairro)}"
    url = re.sub(r"^http://", "https://", url)
    m_url = re.search(r"/imovel/(\d+)/", url)
    if m_url and not id_limpo.isdigit():
        id_limpo = m_url.group(1)

    descricao = limpar_texto(v["descricao"])
    if len(descricao) > LIMITE_DESCRICAO:
        descricao = descricao[:LIMITE_DESCRICAO].rsplit(" ", 1)[0] + "…"

    return {
        "id": id_limpo,
        "codigo": codigo_limpo,
        "tipo": tipo,
        "finalidade": traduzir(limpar_texto(v["finalidade"])) or "Venda",
        "bairro": bairro,
        "cidade": cidade,
        "endereco": limpar_texto(v["endereco"]),
        "preco": numero(v["preco"]),
        "quartos": inteiro(v["quartos"]),
        "suites": inteiro(v["suites"]),
        "banheiros": inteiro(v["banheiros"]),
        "vagas": inteiro(v["vagas"]),
        "area": numero(v["area"]),
        "condominio": numero(v["condominio"]),
        "iptu": numero(v["iptu"]),
        "titulo": limpar_texto(v["titulo"]),
        "descricao": descricao,
        "caracteristicas": sorted(set(limpar_texto(c) for c in caracteristicas if len(c) < 60))[:40],
        "url": url,
        "foto": fotos[0] if fotos else "",
    }


# ======================================================================
# Leitura do site (complementa o feed)
# ======================================================================
UA = "Mozilla/5.0 (compatible; QuintoChat-Catalogo/2.0; +https://www.quintoimoveis.com.br)"
# o slug pode começar com hífen ("/imovel/4320312/-apartamento-venda-...")
RE_LINK_IMOVEL = re.compile(r"\bimovel/(\d{4,})/([a-z0-9\-]+)", re.I)
RE_TITULO_IMOVEL = re.compile(
    r"([A-ZÀ-Ý][A-Za-zÀ-ÿ ]{2,40}?)\s+para\s+Venda,\s*(?:em\s+)?([^,/\n]{0,40}?)\s*(?:/\s*[A-Z]{2})?\s*,\s*bairro\s+([^,\n]{2,40})"
)
PAGINAS_FIXAS = [
    ("/sobre", "O corretor Antônio Quinto"),
    ("/seu-imovel", "Venda seu imóvel"),
    ("/financiamento", "Financiamento"),
    ("/calculadora-financiamento", "Calculadora de financiamento"),
    ("/correspondente", "Correspondente bancário"),
    ("/contato", "Contato"),
    ("/links", "Links úteis"),
    ("/politica-de-privacidade", "Política de privacidade"),
]
MAX_ARTIGOS = 150
VALIDADE_PAGINA_DIAS = 7


def baixar(url, tentativas=3):
    """Baixa uma página do site como texto (respeita a codificação informada pela página)."""
    erro = None
    for n in range(tentativas):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "pt-BR,pt;q=0.9"})
            with urllib.request.urlopen(req, timeout=40) as resp:
                bruto = resp.read()
                charset = resp.headers.get_content_charset()
            if not charset:
                m = re.search(rb"charset=[\"']?([\w\-]+)", bruto[:3000], re.I)
                charset = m.group(1).decode("ascii", "ignore") if m else None
            if charset:
                try:
                    return bruto.decode(charset, errors="replace")
                except LookupError:
                    pass
            try:
                return bruto.decode("utf-8")
            except UnicodeDecodeError:
                return bruto.decode("latin-1")
        except Exception as e:  # rede instável: tenta de novo
            erro = e
            time.sleep(2 * (n + 1))
    raise erro


def texto_de(pagina, sem_head=False, com_atributos=False):
    """HTML -> texto: uma linha por bloco, sem scripts, estilos e comentários.
    com_atributos: os textos de title="" e alt="" também entram (o título do cartão pode estar lá)."""
    t = pagina
    if sem_head:
        t = re.sub(r"(?is)<head\b.*?</head>", " ", t)
    t = re.sub(r"(?is)<(script|style|noscript|svg|template)\b.*?</\1>", " ", t)
    t = re.sub(r"(?s)<!--.*?-->", " ", t)
    if com_atributos:
        t = re.sub(r"<[^>]*?\b(?:title|alt)\s*=\s*\"([^\"]{12,})\"[^>]*>", lambda m: "\n" + m.group(1) + "\n", t)
    t = re.sub(r"<[^>]+>", "\n", t)
    t = corrigir_codificacao(html.unescape(t)).replace("\xa0", " ")
    t = re.sub(r"[ \t\r\f\v]+", " ", t)
    t = re.sub(r" ?\n ?", "\n", t)
    return re.sub(r"\n{2,}", "\n", t).strip()


def meta(pagina, nome):
    """Conteúdo de <meta property|name="nome" content="...">, em qualquer ordem de atributos."""
    for tag in re.findall(r"<meta\b[^>]*>", pagina, flags=re.I):
        if re.search(r"(?:property|name)\s*=\s*[\"']%s[\"']" % re.escape(nome), tag, re.I):
            m = re.search(r"content\s*=\s*\"([^\"]*)\"|content\s*=\s*'([^']*)'", tag, re.I)
            if m:
                return corrigir_codificacao(html.unescape(m.group(1) or m.group(2) or "")).strip()
    return ""


def _n(padrao, t, limite=99):
    m = re.search(padrao, t, re.I)
    if not m:
        return None
    v = inteiro(m.group(1))
    return v if v is not None and 0 <= v <= limite else None


def dados_do_texto(t):
    """Extrai os dados de um imóvel do texto de um cartão da listagem ou da página do imóvel."""
    d = {}
    m = re.search(r"Ref\.?:\s*([A-Za-z]{1,6}\d{1,7})\b", t) or re.search(r"C[óo]digo:\s*([A-Za-z]{1,6}\d{1,7})\b", t)
    if m:
        d["codigo"] = m.group(1).upper()
    m = RE_TITULO_IMOVEL.search(t)
    if m:
        d["tipo"] = m.group(1).strip()
        if m.group(2).strip():
            d["cidade"] = m.group(2).strip()
        d["bairro"] = m.group(3).strip()
    if not d.get("cidade"):
        m = re.search(r"(?:^|\n|,)\s*([^,\n/]{2,40}?)\s*/\s*RJ\b", t)
        if m:
            d["cidade"] = m.group(1).strip()
    if not d.get("bairro"):
        m = re.search(r"Bairro:\s*([^\n›,]{2,40})", t) or re.search(r"(?:^|\n)([^,\n/]{2,40}),\s*[^,\n/]{2,40}/\s*RJ\b", t)
        if m:
            d["bairro"] = m.group(1).strip()
    if not d.get("tipo"):
        m = re.search(r"Ref\.?:\s*[A-Za-z]+\d+\s*[-–\n ]+\s*([A-ZÀ-Ý][a-zà-ÿ]+(?: [A-Za-zà-ÿ]+){0,2})\s*(?:\n|$)", t)
        if m:
            d["tipo"] = m.group(1).strip()
    d["quartos"] = _n(r"(\d{1,2})\s*dormit[óo]rios?", t)
    d["suites"] = _n(r"(\d{1,2})\s*su[ií]tes?", t)
    d["banheiros"] = _n(r"(\d{1,2})\s*banheiros?", t)
    d["vagas"] = _n(r"(\d{1,2})\s*vagas?", t)
    m = (
        re.search(r"[áa]rea\s+[úu]til\s*:?\s*([\d.,]+)\s*m", t, re.I)
        or re.search(r"([\d.,]+)\s*m(?:²|2)\s*[úu]til", t, re.I)
        or re.search(r"([\d.,]+)\s*m(?:²|2)", t, re.I)
    )
    if m:
        d["area"] = numero(m.group(1))
    for m in re.finditer(r"R\$\s*([\d.]+(?:,\d{2})?)", t):
        v = numero(m.group(1))
        if v and v >= 20000:  # ignora condomínio, IPTU e valor por m²
            d["preco"] = v
            break
    m = re.search(r"Endere[çc]o:\s*([^\n|]{3,90})", t)
    if m and not re.match(r"(Bairro|Cidade|C[óo]digo)\b", m.group(1).strip(), re.I):
        d["endereco"] = m.group(1).strip()
    m = re.search(r"Condom[íi]nio:?\s*(?:R\$)?\s*([\d.]+,\d{2})", t, re.I)
    if m:
        d["condominio"] = numero(m.group(1))
    m = re.search(r"IPTU:?\s*(?:R\$)?\s*([\d.]+,\d{2})", t, re.I)
    if m:
        d["iptu"] = numero(m.group(1))
    return {k: v for k, v in d.items() if v not in (None, "")}


def ler_listagem(pagina):
    """Cartões de uma página de listagem: [(id, url, dados)], na ordem em que aparecem."""
    primeiro, ordem = {}, []
    for m in RE_LINK_IMOVEL.finditer(pagina):
        if m.group(1) not in primeiro:
            primeiro[m.group(1)] = (m.start(), f"/imovel/{m.group(1)}/{m.group(2)}")
            ordem.append(m.group(1))
    cartoes = []
    for n, ident in enumerate(ordem):
        ini, caminho = primeiro[ident]
        fim = primeiro[ordem[n + 1]][0] if n + 1 < len(ordem) else min(len(pagina), ini + 9000)
        # recua até o início da tag que contém o link, para não cortar o texto no meio
        ini_tag = pagina.rfind("<", 0, ini)
        trecho = pagina[ini_tag if ini_tag >= 0 else ini : fim]
        dados = dados_do_texto(texto_de(trecho, com_atributos=True))
        m = re.search(r"(?:data-src|data-original|src)\s*=\s*[\"']([^\"']+\.(?:jpe?g|png|webp)[^\"']*)", trecho, re.I)
        if m:
            dados["foto"] = html.unescape(m.group(1))
        cartoes.append((ident, SITE + caminho, dados))
    return cartoes


def ler_pagina_imovel(pagina):
    """Dados da página de um imóvel (completa o que o cartão da listagem não traz)."""
    t = texto_de(pagina)
    pos = t.find("Ref:")
    # título, H1 e a linha "Ref: ..." trazem os dados básicos; o resto da página pode citar outros imóveis
    d = dados_do_texto(t[: pos + 400] if pos >= 0 else t[:1500])
    d.pop("preco", None)
    ficha = dados_do_texto(t[pos : pos + 3000] if pos >= 0 else t[:6000])
    for k in ("preco", "endereco", "condominio", "iptu"):
        if k in ficha:
            d[k] = ficha[k]
    foto = meta(pagina, "og:image")
    if foto:
        d["foto"] = foto
    # descrição: do bloco #desc_descricao até a lista de características (ou o próximo bloco com id)
    m = re.search(r"id\s*=\s*[\"']desc_descricao[\"'][^>]*>", pagina, re.I)
    if m:
        resto = pagina[m.end() : m.end() + 20000]
        corte = re.search(r"\sid\s*=\s*[\"']", resto)
        bloco = resto[: corte.start()] if corte else resto
        carac = re.search(r"<div[^>]*class\s*=\s*[\"'][^\"']*imovel_cx_caracteristicas", bloco, re.I)
        texto = bloco[: carac.start()] if carac else bloco
        texto = re.sub(r"(?is)<(style|script)\b.*?</\1>", " ", texto)
        texto = re.sub(r"(?is)<h[1-6][^>]*>.*?</h[1-6]>", " ", texto)  # tira o título "Descrição do Imóvel"
        desc = limpar_texto(re.sub(r"<[^>]*$", "", texto))
        if len(desc) > LIMITE_DESCRICAO:
            desc = desc[:LIMITE_DESCRICAO].rsplit(" ", 1)[0] + "…"
        if len(desc) >= 40:
            d["descricao"] = desc
        itens = [limpar_texto(x) for x in re.findall(r"(?is)class\s*=\s*[\"']cxItem[\"'][^>]*>(.*?)</div>", bloco)]
        itens = [x for x in dict.fromkeys(itens) if 1 < len(x) < 60]
        if itens:
            d["caracteristicas"] = itens[:40]
    return d


def montar_do_site(ident, url, dados):
    tipo = dados.get("tipo")
    if not tipo:  # último recurso: o começo do endereço ("casa-duplex-venda-...")
        m = re.search(r"/imovel/\d+/([a-z\-]+?)-venda\b", url)
        tipo = m.group(1).replace("-", " ").capitalize() if m else "Imóvel"
    foto = dados.get("foto", "")
    if foto.startswith("//"):
        foto = "https:" + foto
    elif foto.startswith("/"):
        foto = SITE + foto
    bairro = dados.get("bairro", "")
    cidade = dados.get("cidade") or "Niterói"
    quartos = dados.get("quartos")
    titulo = tipo + (f" {quartos} quarto{'s' if quartos != 1 else ''}" if quartos else "")
    if bairro:
        titulo += f" em {bairro}"
    if cidade != "Niterói":
        titulo += f", {cidade}"
    return {
        "id": ident,
        # imóvel sem referência no ImobiBrasil: usa o número do site como código (o agente cita "#4320312")
        "codigo": dados.get("codigo") or ident,
        "tipo": tipo,
        "finalidade": "Venda",
        "bairro": bairro,
        "cidade": cidade,
        "endereco": dados.get("endereco", ""),
        "preco": dados.get("preco"),
        "quartos": quartos,
        "suites": dados.get("suites"),
        "banheiros": dados.get("banheiros"),
        "vagas": dados.get("vagas"),
        "area": dados.get("area"),
        "condominio": dados.get("condominio"),
        "iptu": dados.get("iptu"),
        "titulo": titulo,
        "descricao": dados.get("descricao", ""),
        "caracteristicas": dados.get("caracteristicas", []),
        "url": url,
        "foto": foto,
    }


def completar_pelo_site(itens_feed, baixar=None, pausa=0.3):
    """Acrescenta os imóveis que estão na listagem do site e não vieram no feed.
    Devolve (itens, resumo). Lança exceção se a listagem não for reconhecida."""
    baixar = baixar or globals()["baixar"]
    cartoes, declarado = {}, None
    for pag in range(1, 41):
        pagina = baixar(f"{SITE}/imovel/venda/?pag={pag}")
        if declarado is None:
            m = re.search(r"(\d+)\s+im[óo]veis\s+encontrados", texto_de(pagina), re.I)
            declarado = int(m.group(1)) if m else None
        novos = [c for c in ler_listagem(pagina) if c[0] not in cartoes]
        if not novos:
            break
        for ident, url, dados in novos:
            cartoes[ident] = (url, dados)
        if declarado and len(cartoes) >= declarado:
            break
        time.sleep(pausa)
    if len(cartoes) < 3:
        amostra = re.sub(r"\s+", " ", texto_de(pagina))[:160]
        raise RuntimeError(f"listagem do site não reconhecida ({len(cartoes)} imóveis; a página começa com: {amostra!r})")

    ids_feed = {i["id"] for i in itens_feed}
    codigos_feed = {i["codigo"].upper() for i in itens_feed}
    novos, ignorados = [], []
    for ident, (url, dados) in cartoes.items():
        if ident in ids_feed or dados.get("codigo", "").upper() in codigos_feed:
            continue
        try:
            pagina = ler_pagina_imovel(baixar(url))
            time.sleep(pausa)
        except Exception as e:
            print(f"  aviso: página do imóvel {ident} não lida ({e})")
            pagina = {}
        # o cartão da listagem manda nos dados básicos; a página completa o resto
        item = montar_do_site(ident, url, {**pagina, **dados, **({"foto": pagina["foto"]} if pagina.get("foto") else {})})
        if item["codigo"].upper() in codigos_feed:
            continue
        if item["preco"]:
            novos.append(item)
        else:
            ignorados.append(ident)

    # Só tira do catálogo o que saiu do site quando a leitura da listagem foi completa
    removidos = []
    completo = bool(declarado) and len(cartoes) == declarado
    itens = itens_feed
    if completo:
        codigos_site = {d["codigo"].upper() for _, d in cartoes.values() if d.get("codigo")}
        itens = [i for i in itens_feed if i["id"] in cartoes or i["codigo"].upper() in codigos_site]
        removidos = [i["codigo"] for i in itens_feed if i not in itens]
    resumo = {
        "no_site": len(cartoes), "declarado": declarado, "do_feed": len(itens), "do_site": len(novos),
        "ignorados": ignorados, "removidos": removidos, "completo": completo,
    }
    return itens + novos, resumo


# ---------- conteúdo do site (páginas e artigos), para o agente responder sobre o site ----------
CORTES_RESUMO = ("Olá, Tudo bem?", "Ol\ufffd, Tudo bem?", "Posso ajudar com alguma informa", "Entre em contato via whatsapp", "FALE AGORA CONOSCO")


def resumo_da_pagina(pagina, limite=900):
    """(título, resumo) de uma página do site. O H1 do site é genérico ("Notícias", "Corretor");
    o título bom vem do og:title ou do <title>, e o texto bom começa logo depois do <h1>."""
    titulo = meta(pagina, "og:title")
    if not titulo:
        m = re.search(r"(?is)<title[^>]*>(.*?)</title>", pagina)
        titulo = limpar_texto(m.group(1)) if m else ""
        titulo = re.sub(r"^(Not[íi]cias|Blog|Bairros?)\s*-\s*", "", titulo, flags=re.I)
    titulo = re.sub(r"\s*\|\s*Quinto(\s+Im[óo]veis)?.*$", "", titulo, flags=re.I).strip()
    m = re.search(r"(?is)<h1\b[^>]*>(.*?)</h1>", pagina)
    h1 = limpar_texto(m.group(1)) if m else ""
    corpo = texto_de(pagina[m.end():] if m else pagina, sem_head=not m)
    # notícia: o título do artigo vem logo depois do H1 genérico; o texto começa depois dele
    if titulo and corpo[: len(titulo) + 200].find(titulo[:40]) >= 0:
        corpo = corpo[corpo.find(titulo[:40]) + len(titulo):]
    for c in CORTES_RESUMO:
        k = corpo.find(c)
        if k >= 0:
            corpo = corpo[:k]
    trecho = re.sub(r"\s*\n\s*", " ", corpo).strip(" -")
    if len(trecho) > limite:
        trecho = trecho[:limite].rsplit(" ", 1)[0] + "…"
    return (titulo or h1), trecho


def ler_conteudo_do_site(anteriores, baixar=None, pausa=0.3, hoje=None):
    """Lista de páginas e artigos do site: [{url, tipo, titulo, resumo, lido}].
    Reaproveita o que já foi lido há menos de VALIDADE_PAGINA_DIAS dias."""
    baixar = baixar or globals()["baixar"]
    hoje = hoje or date.today().isoformat()
    cache = {p["url"]: p for p in (anteriores or []) if p.get("url")}
    alvos = [(SITE + caminho, "pagina", nome) for caminho, nome in PAGINAS_FIXAS]

    try:
        inicial = baixar(SITE + "/")
        for caminho in dict.fromkeys(re.findall(r"\bbairro/[a-z0-9\-]+-id-\d+", inicial, flags=re.I)):
            alvos.append((SITE + "/" + caminho, "bairro", ""))
    except Exception as e:
        print(f"  aviso: página inicial não lida ({e})")

    artigos = []
    for pag in range(1, 11):
        try:
            lista = baixar(f"{SITE}/noticias?pag={pag}")
        except Exception as e:
            print(f"  aviso: lista do blog (pág. {pag}) não lida ({e})")
            break
        novos = [c for c in dict.fromkeys(re.findall(r"\bnoticias/[a-z0-9\-]+-\d{3,}", lista, flags=re.I)) if c not in artigos]
        if not novos:
            break
        artigos += novos
        if len(artigos) >= MAX_ARTIGOS:
            break
        time.sleep(pausa)
    alvos += [(SITE + "/" + c, "artigo", "") for c in artigos[:MAX_ARTIGOS]]

    def idade(p):
        try:
            return (date.fromisoformat(hoje) - date.fromisoformat(p.get("lido", ""))).days
        except ValueError:
            return 999

    paginas = []
    for url, tipo, nome in alvos:
        velho = cache.get(url)
        if velho and velho.get("resumo") and idade(velho) < VALIDADE_PAGINA_DIAS:
            paginas.append(velho)
            continue
        try:
            titulo, resumo = resumo_da_pagina(baixar(url))
            time.sleep(pausa)
        except Exception as e:
            print(f"  aviso: {url} não lida ({e})")
            if velho:
                paginas.append(velho)
            continue
        if not (titulo or nome):
            continue
        paginas.append({"url": url, "tipo": tipo, "titulo": nome or titulo, "resumo": resumo, "lido": hoje})
    return paginas


def hoje_sp():
    return datetime.now(timezone(timedelta(hours=-3))).date().isoformat()


def aplicar_historico(itens, anterior, hoje, saidas_confiaveis):
    """Data em que cada imóvel apareceu no catálogo ("desde") e lista dos que saíram ("sairam").
    Na primeira rodada não há como saber as datas antigas: só a partir daí as entradas ganham data."""
    antigos = {i.get("id") or i.get("codigo"): i for i in anterior.get("imoveis", [])}
    tem_historico = bool(anterior.get("historico_desde"))
    for i in itens:
        velho = antigos.get(i.get("id") or i.get("codigo"))
        if velho is not None:
            i["desde"] = velho.get("desde")
        else:
            i["desde"] = hoje if tem_historico else None
    sairam = list(anterior.get("sairam", []))
    if tem_historico and saidas_confiaveis:
        atuais = {i.get("id") or i.get("codigo") for i in itens}
        for chave_, velho in antigos.items():
            if chave_ not in atuais:
                sairam.append({
                    "codigo": velho.get("codigo"), "id": velho.get("id"), "tipo": velho.get("tipo"),
                    "bairro": velho.get("bairro"), "cidade": velho.get("cidade"), "endereco": velho.get("endereco"),
                    "preco": velho.get("preco"), "quartos": velho.get("quartos"), "area": velho.get("area"),
                    "desde": velho.get("desde"), "saiu_em": hoje,
                })
    return itens, sairam[-500:], anterior.get("historico_desde") or hoje


def inspecionar(imoveis):
    print(f"Imóveis encontrados no feed: {len(imoveis)}")
    if not imoveis:
        print("Nenhum imóvel identificado. Confira se a URL é a do feed XML.")
        return
    campos, carac, fotos = achatar(imoveis[0])
    print(f"Tag do imóvel: <{imoveis[0].tag}>\n")
    print("Mapeamento do 1º imóvel:")
    for nome in SINONIMOS:
        valor, tag = pegar(campos, nome)
        mostra = (valor[:70] + "…") if valor and len(valor) > 70 else valor
        print(f"  {nome:<11} <- {('<' + tag + '>') if tag else '(NÃO ENCONTRADO)':<26} {mostra or ''}")
    print(f"\nCaracterísticas: {carac[:12]}")
    print(f"Fotos: {len(fotos)} (1ª: {fotos[0] if fotos else '-'})")
    print("\nTodas as tags do 1º imóvel (para acrescentar em SINONIMOS):")
    print("  " + ", ".join(sorted(campos)))


def main():
    p = argparse.ArgumentParser(description="Gera o catálogo do Quinto Chat a partir do feed XML")
    p.add_argument("--feed", default=os.environ.get("FEED_URL"), help="URL ou arquivo do feed XML")
    p.add_argument("--saida", default="catalogo.json")
    p.add_argument("--inspecionar", action="store_true")
    p.add_argument("--sem-site", action="store_true", help="não lê o site (só o feed)")
    a = p.parse_args()
    if not a.feed:
        sys.exit("Informe --feed ou a variável FEED_URL")

    raiz = ET.fromstring(carregar_feed(a.feed))
    imoveis = achar_imoveis(raiz)

    if a.inspecionar:
        inspecionar(imoveis)
        return

    itens = [i for i in (montar(el) for el in imoveis) if i and i["codigo"]]
    com_preco = sum(1 for i in itens if i["preco"])

    # Trava de segurança: um feed vazio ou quebrado não pode apagar o catálogo bom.
    if not itens or com_preco < len(itens) * 0.5:
        sys.exit(f"Catálogo recusado: {len(itens)} imóveis, {com_preco} com preço. Rode --inspecionar.")

    try:
        with open(a.saida, encoding="utf-8") as f:
            anterior = json.load(f)
    except (OSError, ValueError):
        anterior = {}

    # O feed de portal costuma vir incompleto: completa com o que está à venda no próprio site.
    paginas = anterior.get("paginas", [])
    fontes = {"feed": len(itens), "site": 0}
    leitura = None  # como foi a leitura do site (fica no catálogo, para conferência)
    if not a.sem_site:
        try:
            so_feed = len(itens)
            itens, r = completar_pelo_site(itens)
            fontes = {"feed": r["do_feed"], "site": r["do_site"]}
            leitura = r
            print(
                f"Site: {r['no_site']} imóveis na listagem (o site declara {r['declarado']}); "
                f"feed trouxe {so_feed}; acrescentados {r['do_site']}; fora do site e retirados: {r['removidos'] or 0}; "
                f"não lidos: {r['ignorados'] or 0}"
            )
        except Exception as e:
            leitura = {"erro": str(e)[:300]}
            # site fora do ar nesta rodada: mantém os imóveis que o site tinha trazido na rodada anterior
            ids, codigos = {i["id"] for i in itens}, {i["codigo"].upper() for i in itens}
            guardados = [i for i in anterior.get("imoveis", []) if i.get("id") not in ids and str(i.get("codigo", "")).upper() not in codigos]
            if anterior.get("fontes", {}).get("site"):
                itens = itens + guardados
                fontes = {"feed": len(itens) - len(guardados), "site": len(guardados)}
            print(f"AVISO: não consegui ler a listagem do site ({e}). Mantidos {fontes['site']} imóveis da leitura anterior.")
        if leitura and "erro" in leitura:
            print("Site fora do ar ou bloqueado: mantenho as páginas e artigos já lidos.")
        else:
            try:
                paginas = ler_conteudo_do_site(paginas)
                print(f"Conteúdo do site: {len(paginas)} páginas e artigos")
            except Exception as e:
                print(f"AVISO: não consegui ler as páginas do site ({e}).")

    itens.sort(key=lambda i: (i["bairro"], i["preco"] or 0))

    # Entradas e saídas: só registra saída quando a listagem do site foi lida por inteiro
    # (um feed com falha não pode "vender" imóveis que continuam no site).
    confiavel = bool(leitura and leitura.get("completo"))
    itens, sairam, historico_desde = aplicar_historico(itens, anterior, hoje_sp(), confiavel)

    # Se nada mudou, não regrava (evita commits inúteis a cada 3 horas)
    if (
        anterior.get("imoveis") == itens and anterior.get("paginas", []) == paginas
        and anterior.get("leitura_do_site") == leitura and anterior.get("sairam", []) == sairam
        and anterior.get("historico_desde") == historico_desde
    ):
        print(f"Sem mudanças: {len(itens)} imóveis")
        return

    catalogo = {
        "gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "total": len(itens),
        "fontes": fontes,
        "leitura_do_site": leitura,
        "historico_desde": historico_desde,
        "imoveis": itens,
        "sairam": sairam,
        "paginas": paginas,
    }
    with open(a.saida, "w", encoding="utf-8") as f:
        json.dump(catalogo, f, ensure_ascii=False, separators=(",", ":"))
    print(f"OK: {len(itens)} imóveis gravados em {a.saida}")


if __name__ == "__main__":
    main()
