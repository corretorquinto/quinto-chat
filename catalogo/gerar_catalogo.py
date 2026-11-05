#!/usr/bin/env python3
"""
Quinto Chat - gerador do catálogo
Lê o feed XML do ImobiBrasil e grava um catalogo.json enxuto que o agente consulta.

Uso:
  python gerar_catalogo.py --feed "URL_OU_ARQUIVO" --saida catalogo.json
  python gerar_catalogo.py --feed "URL_OU_ARQUIVO" --inspecionar

--inspecionar mostra os campos do primeiro imóvel e como cada um foi mapeado.
Se algum campo vier vazio, acrescente o nome da tag do seu feed em SINONIMOS.

Sem dependências externas (só a biblioteca padrão do Python).
"""

import argparse
import html
import json
import os
import re
import sys
import unicodedata
import urllib.request
import xml.etree.ElementTree as ET
from collections import Counter
from datetime import datetime, timezone

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

    tipo = traduzir(limpar_texto(v["tipo"])) or "Imóvel"
    bairro = limpar_texto(v["bairro"])
    cidade = limpar_texto(v["cidade"]) or "Niterói"
    url = (v["url"] or "").strip()
    if not url.startswith("http") and v["id"]:
        url = f"{SITE}/imovel/{v['id']}/{slug(tipo)}-venda-{slug(cidade)}-rj-{slug(bairro)}"

    descricao = limpar_texto(v["descricao"])
    if len(descricao) > LIMITE_DESCRICAO:
        descricao = descricao[:LIMITE_DESCRICAO].rsplit(" ", 1)[0] + "…"

    codigo = (v["codigo"] or v["id"] or "").strip()
    return {
        "id": (v["id"] or "").strip(),
        "codigo": codigo,
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

    itens.sort(key=lambda i: (i["bairro"], i["preco"] or 0))

    # Se nada mudou, não regrava (evita commits inúteis a cada 3 horas)
    try:
        with open(a.saida, encoding="utf-8") as f:
            if json.load(f).get("imoveis") == itens:
                print(f"Sem mudanças: {len(itens)} imóveis")
                return
    except (OSError, ValueError):
        pass

    catalogo = {
        "gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "total": len(itens),
        "imoveis": itens,
    }
    with open(a.saida, "w", encoding="utf-8") as f:
        json.dump(catalogo, f, ensure_ascii=False, separators=(",", ":"))
    print(f"OK: {len(itens)} imóveis gravados em {a.saida}")


if __name__ == "__main__":
    main()
