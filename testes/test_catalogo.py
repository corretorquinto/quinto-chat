#!/usr/bin/env python3
"""Testes do gerador do catálogo: leitura da listagem e das páginas do site (sem rede)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "catalogo"))
import gerar_catalogo as g  # noqa: E402

SITE = g.SITE


def cartao(ident, slug, titulo, local, ref, tipo, nums, area, preco, titulo_no_alt=False):
    """Um cartão da listagem; em metade dos casos o título fica só no title/alt da foto."""
    link = f"{SITE}/imovel/{ident}/{slug}"
    foto = f'<a href="{link}"><img class="lazy" data-src="//cdn.site/fotos/{ident}.jpg" alt="{titulo}"></a>'
    cab = "" if titulo_no_alt else f'<h2><a href="{link}">{titulo} <span>Oportunidade</span></a></h2>'
    itens = "".join(f"<li><b>{n}</b> <span>{rot}</span></li>" for n, rot in nums)
    return (
        f'<article class="imovel">{foto}{cab}<span>Venda</span><p>{local}</p>'
        f"<p>Ref: {ref} - <em>{tipo}</em></p><ul>{itens}<li><b>{area} m&sup2;</b> <span>&Uacute;til</span></li></ul>"
        f'<div class="preco">R$ {preco}</div><p>### Descrição curta do imóvel, próximo a tudo...</p>'
        f'<a href="{link}">mais detalhes</a></article>'
    )


def listagem(pag, cartoes, total=5):
    return (
        "<html><head><title>Imóveis</title></head><body><nav><a href='/sobre'>Corretor</a></nav>"
        f"<p>{total} imóveis encontrados. Página {pag}</p>" + "".join(cartoes) + "<footer>Quinto Imóveis</footer></body></html>"
    )


PAG1 = listagem(1, [
    cartao("4383031", "apartamento-venda-niteroi-rj-santa-rosa", "Apartamento para Venda, em Niterói, bairro Santa Rosa, 2 dormitórios, 2 banheiros, 1 suíte, 1 vaga", "Santa Rosa, Niterói / RJ", "QI1626", "Apartamento", [("2", "Dormitórios"), ("2", "Banheiros"), ("1", "Vaga")], "70", "400.000"),
    cartao("3374962", "casa-venda-marica-rj-centro", "Casa para Venda, em Maricá, bairro Centro, 4 dormitórios, 4 banheiros, 1 suíte, 4 vagas", "Centro, Maricá / RJ", "QI1487", "Casa", [("4", "Dormitórios"), ("4", "Banheiros"), ("4", "Vagas")], "255", "1.100.000", titulo_no_alt=True),
    cartao("4362856", "apartamento-venda-icarai-mariz-e-barros-1-quarto-65m2-niteroi-rj", "Apartamento para Venda, em , bairro Icaraí, 1 dormitório, 1 banheiro, 1 vaga", "Icaraí, Niterói / RJ", "QI1620", "Apartamento", [("1", "Dormitório"), ("1", "Banheiro"), ("1", "Vaga")], "65", "539.000"),
])
PAG2 = listagem(2, [
    cartao("1584643", "casa-duplex-venda-niteroi-rj-vila-progresso", "Casa Duplex para Venda, em Niterói, bairro Vila Progresso, 3 dormitórios, 3 banheiros, 2 vagas", "Vila Progresso, Niterói / RJ", "QI1101", "Casa Duplex", [("3", "Dormitórios"), ("3", "Banheiros"), ("2", "Vagas")], "180", "950.000"),
    cartao("2042020", "cobertura-venda-niteroi-rj-piratininga", "Cobertura para Venda, em Niterói, bairro Piratininga, 3 dormitórios, 2 banheiros, 1 suíte, 2 vagas", "Piratininga, Niterói / RJ", "QI1200", "Cobertura", [("3", "Dormitórios"), ("2", "Banheiros"), ("2", "Vagas")], "150,5", "1.250.000", titulo_no_alt=True),
])

PAGINA_MARICA = """<html><head><meta charset="utf-8">
<title>Casa para Venda, Maricá / RJ, bairro Centro, 4 dormitórios, sendo 1 suíte, 4 banheiros, 4 vagas de garagem, área útil 255 m², terreno 401 m²</title>
<meta content="https://cdn.site/fotos/grande-3374962.jpg" property="og:image">
<script>var x = "R$ 9.999.999";</script></head><body>
<h1>Casa para Venda, Maricá / RJ</h1>
<p id="desc_tags">Ref: QI1487, bairro Centro, 4 dormitórios, sendo 1 suíte, 4 banheiros, 4 vagas de garagem, área útil 255 m², terreno 401 m²</p>
<div class="valor"><strong>R$ 1.100.000</strong></div>
<div><span>Condomínio</span> <b>R$ 600,00</b></div><div><span>IPTU</span> <b>200,00</b></div>
<ul><li><b>4</b> Dormitórios</li><li><b>1</b> Suíte</li><li><b>4</b> Banheiros</li><li><b>4</b> Vagas</li></ul>
<p>Área Útil: 255 m²</p><p>Área Terreno: 401 m²</p><p>Valor por m²: 4.313,00</p>
<div id="desc_descricao"><h3>Descrição do Imóvel</h3><p>Descubra a casa dos seus sonhos no coração de Maricá!</p>
<p>Esta impressionante casa duplex, localizada no bairro Centro, tem piscina e quadra de futebol.<br>Agende sua visita.</p></div>
<div id="desc_ficha"><p>Código: QI1487</p><p>Endereço: <span>Rua Pereira Neves</span></p><p>Bairro: <a href="#">Centro›</a></p></div>
<section id="semelhantes"><a href="/imovel/9999999/apartamento-venda-niteroi-rj-icarai">Apartamento para Venda, em Niterói, bairro Icaraí, 9 dormitórios</a> Ref: QI9999 R$ 5.000.000</section>
</body></html>"""

ARTIGO = """<html><head><title>Rua Otávio Carneiro, Icaraí: quanto custa um apartamento em 2026? | Quinto Imóveis</title>
<meta name="description" content="Preços e perfil dos imóveis da Rua Otávio Carneiro."></head><body><nav>Inicial Notícias</nav>
<h1>Rua Otávio Carneiro, Icaraí: quanto custa um apartamento em 2026?</h1><div class="noticias__title__data">05/11/2026</div>
<p>A Rua Otávio Carneiro é uma das mais arborizadas de Icaraí.</p><p>O metro quadrado gira em torno de valores altos.</p></body></html>"""


def site_falso(extra=None, falhar=()):
    paginas = {
        f"{SITE}/imovel/venda/?pag=1": PAG1,
        f"{SITE}/imovel/venda/?pag=2": PAG2,
        f"{SITE}/imovel/venda/?pag=3": PAG2,  # além da última página o site repete a última
        f"{SITE}/imovel/3374962/casa-venda-marica-rj-centro": PAGINA_MARICA,
        f"{SITE}/": '<a href="/bairro/santa-rosa-niteroi-como-e-morar-no-bairro-id-4145">Santa Rosa</a>',
        f"{SITE}/noticias?pag=1": '<a href="/noticias/rua-otavio-carneiro-icarai-quanto-custa-um-apartamento-em-2026-30741">x</a>',
        f"{SITE}/noticias?pag=2": '<a href="/noticias/rua-otavio-carneiro-icarai-quanto-custa-um-apartamento-em-2026-30741">x</a>',
        f"{SITE}/noticias/rua-otavio-carneiro-icarai-quanto-custa-um-apartamento-em-2026-30741": ARTIGO,
    }
    paginas.update(extra or {})
    pedidos = []

    def baixar(url):
        pedidos.append(url)
        if url in falhar or url not in paginas:
            raise OSError("404")
        return paginas[url]

    baixar.pedidos = pedidos
    return baixar


def do_feed(ident, codigo, bairro="Icaraí"):
    return {"id": ident, "codigo": codigo, "tipo": "Apartamento", "finalidade": "Venda", "bairro": bairro, "cidade": "Niterói",
            "endereco": "", "preco": 400000.0, "quartos": 2, "suites": 1, "banheiros": 2, "vagas": 1, "area": 70.0, "condominio": None,
            "iptu": None, "titulo": "Do feed", "descricao": "texto do feed", "caracteristicas": ["Varanda"], "url": "u", "foto": "f"}


class Listagem(unittest.TestCase):
    def test_cartoes_da_listagem(self):
        c = {i: d for i, _, d in g.ler_listagem(PAG1)}
        self.assertEqual(list(c), ["4383031", "3374962", "4362856"])
        m = c["3374962"]  # título só no alt da foto
        self.assertEqual((m["codigo"], m["tipo"], m["cidade"], m["bairro"]), ("QI1487", "Casa", "Maricá", "Centro"))
        self.assertEqual((m["quartos"], m["suites"], m["banheiros"], m["vagas"], m["area"], m["preco"]), (4, 1, 4, 4, 255.0, 1100000.0))
        self.assertEqual(m["foto"], "//cdn.site/fotos/3374962.jpg")
        # cidade em branco no título: vem da linha "Icaraí, Niterói / RJ"
        self.assertEqual((c["4362856"]["cidade"], c["4362856"]["bairro"], c["4362856"]["quartos"]), ("Niterói", "Icaraí", 1))
        d = {i: x for i, _, x in g.ler_listagem(PAG2)}
        self.assertEqual((d["1584643"]["tipo"], d["1584643"]["bairro"]), ("Casa Duplex", "Vila Progresso"))
        self.assertEqual(d["2042020"]["area"], 150.5)

    def test_pagina_do_imovel(self):
        d = g.ler_pagina_imovel(PAGINA_MARICA)
        self.assertEqual((d["codigo"], d["tipo"], d["cidade"], d["bairro"]), ("QI1487", "Casa", "Maricá", "Centro"))
        self.assertEqual((d["preco"], d["condominio"], d["iptu"], d["endereco"]), (1100000.0, 600.0, 200.0, "Rua Pereira Neves"))
        self.assertEqual(d["foto"], "https://cdn.site/fotos/grande-3374962.jpg")
        self.assertTrue(d["descricao"].startswith("Descubra a casa dos seus sonhos"))
        self.assertIn("piscina", d["descricao"])
        self.assertNotIn("Código", d["descricao"])  # para no próximo bloco com id
        self.assertNotIn("QI9999", d["descricao"])

    def test_completa_o_feed_com_o_site(self):
        feed = [do_feed("4383031", "QI1626", "Santa Rosa"), do_feed("4362856", "QI1620")]
        baixar = site_falso()
        itens, r = g.completar_pelo_site(feed, baixar, pausa=0)
        self.assertEqual((r["no_site"], r["declarado"], r["do_feed"], r["do_site"], r["completo"]), (5, 5, 2, 3, True))
        por = {i["codigo"]: i for i in itens}
        self.assertEqual(por["QI1626"]["titulo"], "Do feed")  # o que veio do feed fica como está
        m = por["QI1487"]
        self.assertEqual((m["id"], m["cidade"], m["bairro"], m["preco"], m["quartos"]), ("3374962", "Maricá", "Centro", 1100000.0, 4))
        self.assertEqual((m["titulo"], m["endereco"], m["condominio"]), ("Casa 4 quartos em Centro, Maricá", "Rua Pereira Neves", 600.0))
        self.assertEqual(m["foto"], "https://cdn.site/fotos/grande-3374962.jpg")
        self.assertIn("piscina", m["descricao"])
        # página do imóvel fora do ar: entra só com os dados do cartão
        d = por["QI1101"]
        self.assertEqual((d["tipo"], d["preco"], d["descricao"], d["foto"]), ("Casa Duplex", 950000.0, "", "https://cdn.site/fotos/1584643.jpg"))
        self.assertEqual(set(d), set(feed[0]))  # mesmo formato dos itens do feed
        # não baixa a página dos imóveis que já vieram no feed
        self.assertNotIn(f"{SITE}/imovel/4383031/apartamento-venda-niteroi-rj-santa-rosa", baixar.pedidos)

    def test_tira_o_que_saiu_do_site_so_com_leitura_completa(self):
        feed = [do_feed("4383031", "QI1626"), do_feed("1111111", "QI0001")]  # QI0001 não está mais no site
        itens, r = g.completar_pelo_site(feed, site_falso(), pausa=0)
        self.assertEqual(r["removidos"], ["QI0001"])
        self.assertNotIn("QI0001", [i["codigo"] for i in itens])
        # leitura incompleta (o site declara 9 e só achamos 5): não tira nada
        extra = {f"{SITE}/imovel/venda/?pag=1": PAG1.replace("5 imóveis encontrados", "9 imóveis encontrados")}
        itens, r = g.completar_pelo_site(feed, site_falso(extra), pausa=0)
        self.assertEqual((r["completo"], r["removidos"]), (False, []))
        self.assertIn("QI0001", [i["codigo"] for i in itens])

    def test_listagem_nao_reconhecida_levanta_erro(self):
        extra = {f"{SITE}/imovel/venda/?pag=1": "<html><body>Manutenção</body></html>"}
        with self.assertRaises(RuntimeError):
            g.completar_pelo_site([do_feed("1", "QI1")], site_falso(extra), pausa=0)


class Conteudo(unittest.TestCase):
    def test_paginas_e_artigos(self):
        baixar = site_falso({f"{SITE}/sobre": "<html><head><title>Corretor | Quinto Imóveis</title></head><body><h1>Corretor</h1><p>Antônio Quinto, CRECI-RJ 040171, 17 anos de mercado.</p></body></html>"})
        p = g.ler_conteudo_do_site([], baixar, pausa=0, hoje="2026-11-10")
        por = {x["url"]: x for x in p}
        a = por[f"{SITE}/noticias/rua-otavio-carneiro-icarai-quanto-custa-um-apartamento-em-2026-30741"]
        self.assertEqual((a["tipo"], a["titulo"]), ("artigo", "Rua Otávio Carneiro, Icaraí: quanto custa um apartamento em 2026?"))
        self.assertIn("uma das mais arborizadas", a["resumo"])
        self.assertNotIn("Inicial Notícias", a["resumo"])
        s = por[f"{SITE}/sobre"]
        self.assertEqual((s["tipo"], s["titulo"]), ("pagina", "O corretor Antônio Quinto"))
        self.assertIn("CRECI-RJ 040171", s["resumo"])
        # na rodada seguinte, o que foi lido há menos de 7 dias não é baixado de novo
        baixar2 = site_falso()
        p2 = g.ler_conteudo_do_site(p, baixar2, pausa=0, hoje="2026-11-12")
        self.assertEqual(p2, p)
        self.assertNotIn(a["url"], baixar2.pedidos)
        baixar3 = site_falso()
        g.ler_conteudo_do_site(p, baixar3, pausa=0, hoje="2026-11-20")
        self.assertIn(a["url"], baixar3.pedidos)


# ---------- trechos no formato real do site (conferidos em 10/11/2026) ----------
MENU = "<ul class='menu'><li><a href='/'>Inicial</a></li><li><a href='/noticias'>Notícias</a></li><li><a href='/sobre'>Corretor</a></li><li>Blog Imobiliário</li></ul>"


def cartao_real(ident, slug, titulo, local, ref, nums, area, preco):
    link = f"https://www.quintoimoveis.com.br/imovel/{ident}/{slug}"
    ref_html = f"<span>Ref: {ref}</span> - " if ref else ""
    itens = "".join(f"<li><span>{n}</span><small>{r}</small></li>" for n, r in nums)
    return (
        f'<div class="card"><a href="{link}" title="{titulo}"><img src="https://imgs1.cdn-imobibrasil.com.br/imagens/imoveis/thumb15-{ident}.jpg" alt="{titulo}"></a>'
        f'<h3><a href="{link}">{titulo}</a></h3><span>Pronto para Morar</span><span>Venda</span><p>{local}</p>'
        f"<p>{ref_html}<span>Apartamento</span></p><ul>{itens}<li><span>{area} m&sup2;</span><small>&Uacute;til</small></li></ul>"
        f'<div class="valor"><small>R$</small><strong>{preco}</strong></div><a href="#">enviar mensagem</a><a>descrição</a><a>fotos</a>'
        f"<p>Apartamento com 3 quartos, por R$ 999.999. Morar em Icaraí...</p></div>"
    )


LISTA_REAL = (
    f"<html><body>{MENU}<p><b>3</b> imóveis encontrados. Página 1</p>"
    + cartao_real("4396807", "apartamento-venda-niteroi-rj-icarai", "Apartamento para Venda, em Niterói, bairro Icaraí, 3 dormitórios, 3 banheiros, 1 suíte, 1 vaga",
                  "Apartamento 3 quartos com suíte, 100 m² em Icaraí | Quinto, Niterói / RJ", "QI1627", [("3", "Dormitórios"), ("3", "Banheiros"), ("1", "Vaga")], "100", "750.000")
    + cartao_real("4320312", "-apartamento-venda-icarai-doutor-tavares-de-macedo-2-quartos-80m2", "Apartamento para Venda, em Niterói, bairro Icaraí, 2 dormitórios, 2 banheiros, 1 vaga",
                  "Icaraí, Niterói / RJ", "QI1615", [("2", "Dormitórios"), ("2", "Banheiros"), ("1", "Vaga")], "80", "620.000")
    + cartao_real("3411102", "apartamento-venda-niteroi-rj-icarai", "Apartamento para Venda, em Niterói, bairro Icaraí, 4 dormitórios, 3 banheiros, 1 suíte, 1 vaga",
                  "Icaraí, Niterói / RJ", "", [("4", "Dormitórios"), ("3", "Banheiros"), ("1", "Vaga")], "160", "1.390.000")
    + "</body></html>"
)

IMOVEL_REAL = """<html><head><title>Casa para Venda, Maric&aacute; / RJ, bairro Centro, 4 dormit&oacute;rios, sendo 1 su&iacute;te, 4 banheiros, 4 vagas de garagem, &aacute;rea &uacute;til 255 m&sup2;, terreno 401 m&sup2;</title>
<meta property="og:image" content="https://www.quintoimoveis.com.br/imagens/imoveis/202409231925408454.jpeg"/></head><body>""" + MENU + """
<div id="desc_info"><div>Casa para Venda, Maricá / RJ por R$ 1.100.000</div><form><b>FALE AGORA CONOSCO</b><textarea>Olá! Achei esse imóvel</textarea></form>
<h1>Casa para Venda, Maricá / RJ</h1><p>Ref: QI1487,</p><p>bairro Centro, 4 dormitórios, sendo 1 suíte, 4 banheiros, 4 vagas de garagem, área útil 255 m², terreno 401 m²</p></div>
<div id="info__valor"><b>R$ 1.100.000</b><span>Condomínio</span><b>R$ 600,00</b><span>IPTU</span><b>200,00</b></div>
<div id="desc_tags"><span>Código:</span><b>QI1487</b><span>Endereço:</span><b>Rua Pereira Neves</b><span>Bairro:</span><a>Centro</a>›</div>
<div id="desc_descricao">\r\n<h2 class="content__title">Descri&ccedil;&atilde;o do Im&oacute;vel</h2><p><div style="text-align:justify"><span>Descubra a casa dos seus sonhos no cora&ccedil;&atilde;o de Maric&aacute;! Com piscina de 8x4 metros.<br /> <br /> Condom&iacute;nio <strong>R$ 600,00</strong> e IPTU <strong>R$ 200,00</strong> mensais.</span>
<style> .imovel_cx_caracteristicas { display:block; } </style><div class="fonte_padrao imovel_cx_caracteristicas"><div class="cxSpan">Características</div><div class="cxItem"><i class="fa fa-check"></i> Portão Eletrônico</div><div class="clear"></div></div>
<div class="fonte_padrao imovel_cx_caracteristicas"><div class="cxSpan">Infraestrutura</div><div class="cxItem"><i class="fa fa-check"></i> Piscina</div><div class="cxItem"><i class="fa fa-check"></i> Quadra de Futebol</div></div></div>
<div id="desc_mapa-localizacao">Mapa</div></body></html>"""

NOTICIA_REAL = """<html><head><title>Not&iacute;cias - Rua Ot&aacute;vio Carneiro, Icara&iacute;: quanto custa um apartamento em 2026?</title>
<meta property="og:title" content="Rua Ot&aacute;vio Carneiro, Icara&iacute;: quanto custa um apartamento em 2026?" /></head><body>""" + MENU + MENU + """
<h1>Notícias</h1><h2>Rua Otávio Carneiro, Icaraí: quanto custa um apartamento em 2026?</h2><p>21/09/2026 - Bairro Icaraí: Guia de Ruas</p>
<p>A Rua Otávio Carneiro liga o Campo de São Bento à Praia de Icaraí.</p>
<div class="zap">QUINTO IMÓVEIS x Olá, Tudo bem? Posso ajudar com alguma informação?</div></body></html>"""

SOBRE_REAL = """<html><head><title>Corretor - Im&oacute;veis &agrave; Venda em Niter&oacute;i e Icara&iacute; | Quinto Im&oacute;veis</title></head><body>""" + MENU + """
<h1>Corretor</h1><p>Antônio Quinto é corretor de imóveis credenciado pelo CRECI-RJ (nº 040171), <b>Bacharel em Direito</b>.</p></body></html>"""


class FormatoReal(unittest.TestCase):
    def test_listagem_real(self):
        c = {i: (u, d) for i, u, d in g.ler_listagem(LISTA_REAL)}
        self.assertEqual(list(c), ["4396807", "4320312", "3411102"])  # o link com hífen também entra
        self.assertEqual(c["4320312"][0], f"{SITE}/imovel/4320312/-apartamento-venda-icarai-doutor-tavares-de-macedo-2-quartos-80m2")
        d = c["4396807"][1]
        self.assertEqual((d["codigo"], d["bairro"], d["cidade"], d["quartos"], d["area"], d["preco"]), ("QI1627", "Icaraí", "Niterói", 3, 100.0, 750000.0))
        self.assertEqual(c["4320312"][1]["preco"], 620000.0)
        self.assertNotIn("codigo", c["3411102"][1])
        item = g.montar_do_site("3411102", c["3411102"][0], c["3411102"][1])
        self.assertEqual((item["codigo"], item["preco"]), ("3411102", 1390000.0))  # sem Ref: usa o número do site

    def test_pagina_real_do_imovel(self):
        d = g.ler_pagina_imovel(IMOVEL_REAL)
        self.assertEqual((d["codigo"], d["tipo"], d["cidade"], d["bairro"]), ("QI1487", "Casa", "Maricá", "Centro"))
        self.assertEqual((d["preco"], d["condominio"], d["iptu"], d["endereco"], d["quartos"]), (1100000.0, 600.0, 200.0, "Rua Pereira Neves", 4))
        self.assertTrue(d["descricao"].startswith("Descubra a casa"), d["descricao"][:60])
        self.assertNotIn("Descrição do Imóvel", d["descricao"])
        self.assertNotIn("display:block", d["descricao"])
        self.assertNotIn("Portão Eletrônico", d["descricao"])
        self.assertEqual(d["caracteristicas"], ["Portão Eletrônico", "Piscina", "Quadra de Futebol"])

    def test_noticia_e_pagina_reais(self):
        t, r = g.resumo_da_pagina(NOTICIA_REAL)
        self.assertEqual(t, "Rua Otávio Carneiro, Icaraí: quanto custa um apartamento em 2026?")
        self.assertTrue(r.startswith("21/09/2026 - Bairro Icaraí"), r[:80])
        self.assertIn("liga o Campo de São Bento", r)
        self.assertNotIn("Inicial", r)
        self.assertNotIn("Tudo bem", r)
        t, r = g.resumo_da_pagina(SOBRE_REAL)
        self.assertTrue(r.startswith("Antônio Quinto é corretor"), r[:60])


class Historico(unittest.TestCase):
    def it(self, i, c):
        return {"id": i, "codigo": c, "tipo": "Apartamento", "bairro": "Icaraí", "cidade": "Niterói", "preco": 1.0}

    def test_entradas_e_saidas(self):
        # 1ª rodada: sem histórico anterior, ninguém ganha data (não dá para saber quando entraram)
        itens, sairam, desde = g.aplicar_historico([self.it("1", "A"), self.it("2", "B")], {"imoveis": [self.it("1", "A")]}, "2026-11-10", True)
        self.assertEqual(([i["desde"] for i in itens], sairam, desde), ([None, None], [], "2026-11-10"))
        ant = {"imoveis": itens, "historico_desde": desde, "sairam": []}
        # 2ª rodada: entra C, sai B
        itens, sairam, desde = g.aplicar_historico([self.it("1", "A"), self.it("3", "C")], ant, "2026-11-11", True)
        self.assertEqual({i["codigo"]: i["desde"] for i in itens}, {"A": None, "C": "2026-11-11"})
        self.assertEqual([(s["codigo"], s["saiu_em"]) for s in sairam], [("B", "2026-11-11")])
        # leitura do site incompleta: não registra saída
        _, sairam2, _ = g.aplicar_historico([self.it("1", "A")], {"imoveis": itens, "historico_desde": desde, "sairam": sairam}, "2026-11-12", False)
        self.assertEqual(len(sairam2), 1)


if __name__ == "__main__":
    unittest.main(verbosity=1)
