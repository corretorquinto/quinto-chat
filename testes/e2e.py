"""
Teste de ponta a ponta do Quinto Chat com réplicas dos formulários do ImobiBrasil.
Pré-requisito: node testes/servidor-e2e.mjs rodando (porta 8790).
Uso: python3 testes/e2e.py [pasta_para_prints]
"""
import asyncio
import json
import os
import sys
import urllib.parse
import urllib.request

from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8790"
PRINTS = sys.argv[1] if len(sys.argv) > 1 else None
falhas = []


def confere(cond, msg):
    print(("  ok  " if cond else "  FALHOU  ") + msg)
    if not cond:
        falhas.append(msg)


def registros():
    with urllib.request.urlopen(BASE + "/__registros") as r:
        return json.load(r)


def campos(corpo_latin1):
    return dict(urllib.parse.parse_qsl(corpo_latin1, encoding="latin-1"))


INIT = """
window.__abertos = [];
window.open = function (u) { window.__abertos.push(u); return null; };
"""

SR = "document.querySelector('#quinto-chat').shadowRoot"


async def nova_pagina(navegador, largura=1280, altura=900):
    ctx = await navegador.new_context(viewport={"width": largura, "height": altura})
    await ctx.add_init_script(INIT)
    await ctx.route("https://web.whatsapp.com/**", lambda r: r.fulfill(status=200, body="whatsapp"))
    pg = await ctx.new_page()
    pg.erros = []
    pg.on("pageerror", lambda e: pg.erros.append(str(e)))
    return pg


async def falar(pg, texto):
    await pg.locator("#quinto-chat .lancador").click() if await pg.locator("#quinto-chat .lancador").is_visible() else None
    await pg.locator("#quinto-chat .entrada textarea").fill(texto)
    await pg.keyboard.press("Enter")
    await pg.wait_for_timeout(700)


async def shot(pg, nome):
    if PRINTS:
        await pg.screenshot(path=f"{PRINTS}/{nome}.png")


async def cenario_busca(nav):
    print("\n[1] Busca personalizada -> Fale Conosco")
    pg = await nova_pagina(nav, 390, 800)
    await pg.goto(BASE + "/")
    await falar(pg, "Não achei o imóvel que procuro")
    f = "#quinto-chat .ficha "
    confere(await pg.locator(f).count() == 1, "ficha de busca aparece no chat")
    confere(await pg.locator(f + "[name=bairros]").input_value() == "Icaraí, Santa Rosa", "bairros pré-preenchidos")
    confere(await pg.locator(f + "[name=faixa]").input_value() == "800a1200", "faixa de valor pré-preenchida (900 mil -> R$ 800 mil a R$ 1,2 milhão)")
    confere(await pg.locator(f + ".calc").is_hidden(), "link da calculadora escondido com faixa escolhida")
    confere(await pg.locator(f + "[name=suite]").is_checked(), "suíte marcada")
    await shot(pg, "1a_ficha_busca_celular")
    # tenta enviar sem dados
    await pg.locator(f + ".enviar-ficha").click()
    erros = await pg.evaluate(f"[...{SR}.querySelectorAll('.ficha [aria-invalid=true]')].map(e=>e.name)")
    confere(erros == ["nome", "telefone", "email"], f"nome, telefone e e-mail obrigatórios ({erros})")
    await pg.locator(f + "[name=nome]").fill("João da Silva")
    await pg.locator(f + "[name=telefone]").type("21987654321")
    confere(await pg.locator(f + "[name=telefone]").input_value() == "(21) 98765-4321", "máscara do telefone no chat")
    await pg.locator(f + "[name=email]").fill("joao@exemplo.com")
    await pg.locator(f + "[name=permuta]").fill("apartamento de 2 quartos no Ingá")
    # faixa é obrigatória
    await pg.locator(f + "[name=faixa]").select_option("")
    await pg.locator(f + ".enviar-ficha").click()
    erros = await pg.evaluate(f"[...{SR}.querySelectorAll('.ficha [aria-invalid=true]')].map(e=>e.name)")
    confere(erros == ["faixa"], f"faixa de valor obrigatória ({erros})")
    await pg.locator(f + "[name=faixa]").select_option("nao_sei")
    confere(await pg.locator(f + ".calc").is_visible(), "'Ainda não sei' mostra o link da calculadora")
    confere(await pg.locator(f + ".calc").get_attribute("href") == "https://www.quintoimoveis.com.br/calculadora-financiamento", "link aponta para a calculadora")
    await shot(pg, "1a2_faixa_nao_sei_celular")
    await pg.locator(f + ".enviar-ficha").click()
    await pg.wait_for_url("**/contato", timeout=5000)
    await pg.wait_for_timeout(900)
    form = "#frmContato "
    confere(await pg.locator(form + "[name=nome]").input_value() == "João da Silva", "Fale Conosco: nome preenchido")
    confere(await pg.locator(form + "[name=endemail]").input_value() == "joao@exemplo.com", "Fale Conosco: e-mail preenchido")
    confere(await pg.locator(form + "[name=telefone]").input_value() == "(21) 98765-4321", "Fale Conosco: telefone no formato do site")
    msg = await pg.locator(form + "[name=mensagem]").input_value()
    confere(msg.startswith("BUSCA PERSONALIZADA (pelo assistente do site)\nProcuro: Apartamento, 3+ quartos, com suíte, em Icaraí, Santa Rosa\nQuanto pretendo investir: ainda não sei / quero simular financiamento"), f"mensagem da busca montada: {msg[:160]!r}")
    confere("Imóvel para permuta: apartamento de 2 quartos no Ingá" in msg and "Pagamento: Financiamento" in msg, "permuta e pagamento na mensagem")
    confere(await pg.evaluate(f"!{SR}.querySelector('.guia').hidden"), "aviso 'Falta só um passo' visível")
    confere(await pg.evaluate("document.activeElement && document.activeElement.name") == "chave", "cursor no campo do código")
    confere(await pg.locator(form + "[name=chave]").input_value() == "", "código NÃO é preenchido pelo chat")
    await shot(pg, "1b_fale_conosco_preenchido_celular")
    # código errado: o próprio site barra
    await pg.locator(form + "[name=chave]").fill("9999")
    await pg.locator("#btn_enviar_contato").click()
    await pg.wait_for_timeout(300)
    confere(not any("acao=gravar" in r["rota"] for r in registros()), "código errado não envia")
    await pg.locator(form + "[name=chave]").fill("0215")
    await pg.locator("#btn_enviar_contato").click()
    await pg.wait_for_url("**/contato/?acao=gravar", timeout=5000)
    await pg.wait_for_timeout(600)
    env = [r for r in registros() if r["rota"] == "/contato/?acao=gravar"]
    confere(len(env) == 1, "Fale Conosco enviado ao servidor (cai no CRM)")
    c = campos(env[-1]["corpo"])
    confere(c.get("nome") == "João da Silva" and "Icaraí" in c.get("mensagem", ""), "acentos chegam certos (ISO-8859-1)")
    await pg.locator("#quinto-chat .lancador").click()
    ultima = await pg.evaluate(f"[...{SR}.querySelectorAll('.msg.bot .balao')].at(-1).innerText")
    confere(ultima.startswith("Recebido!"), "chat confirma o envio na página seguinte")
    confere("calculadora-financiamento" in ultima, "confirmação lembra a calculadora")
    await shot(pg, "1c_confirmacao_celular")
    confere(not pg.erros, f"sem erros de JavaScript {pg.erros}")
    await pg.context.close()


async def cenario_imovel(nav):
    print("\n[2] Visita a um imóvel -> formulário da página do imóvel")
    pg = await nova_pagina(nav)
    await pg.goto(BASE + "/imovel/4383031/apartamento-venda-niteroi-rj-santa-rosa")
    await falar(pg, "Quero agendar uma visita")
    f = "#quinto-chat .ficha "
    msg = await pg.locator(f + "[name=mensagem]").input_value()
    confere(msg.startswith("Olá! Tenho interesse no imóvel #QI1626 (Apartamento 2 quartos com suíte em Santa Rosa) e gostaria de agendar uma visita."), "mensagem do imóvel pré-preenchida")
    await pg.locator(f + "[name=nome]").fill("Maria")
    await pg.locator(f + "[name=telefone]").fill("(21) 99876-5432")
    await pg.locator(f + "[name=email]").fill("maria@exemplo.com")
    await shot(pg, "2a_ficha_imovel_desktop")
    await pg.locator(f + ".enviar-ficha").click()
    await pg.wait_for_timeout(1200)
    confere(await pg.locator("form[name=frmcon1] [name=nome]").input_value() == "Maria", "formulário do imóvel preenchido na mesma página")
    confere(await pg.locator("form[name=frmcon1] [name=telefone1]").input_value() == "(21) 99876-5432", "telefone no formato aceito pelo site")
    confere("sábado de manhã" in await pg.locator("form[name=frmcon1] [name=mensagem]").input_value(), "resumo da conversa na mensagem")
    confere(await pg.evaluate(f"{SR}.querySelector('.painel').hidden"), "chat fecha para mostrar o formulário")
    await shot(pg, "2b_formulario_imovel_desktop")
    await pg.locator("form[name=frmcon1] [name=chave]").fill("7884")
    await pg.locator("#btnenviar3").click()
    await pg.wait_for_timeout(800)
    env = [r for r in registros() if r["rota"].startswith("/imovel-mais-info/")]
    confere(len(env) == 1, "pedido do imóvel enviado (cai no CRM como Informações do Imóvel)")
    confere(campos(env[-1]["corpo"]).get("email") == "maria@exemplo.com", "e-mail correto no envio")
    dl = await pg.evaluate("(window.dataLayer||[]).filter(e=>e.event==='quinto_chat').map(e=>e.quinto_chat_acao)")
    confere("lead_enviado" in dl and "ficha_preenchida" in dl, f"eventos GA4 ({dl})")
    confere(not pg.erros, f"sem erros de JavaScript {pg.erros}")
    await pg.context.close()


async def cenario_venda_e_whatsapp(nav):
    print("\n[3] Venda + WhatsApp pelo chat (registra no WhatsApp Lead)")
    pg = await nova_pagina(nav)
    await pg.goto(BASE + "/")
    await falar(pg, "Quero vender meu imóvel")
    f = "#quinto-chat .ficha "
    confere(await pg.locator(f + "[name=tipo]").input_value() == "Cobertura", "ficha de venda pré-preenchida (tipo)")
    confere(await pg.locator(f + "[name=aceita_permuta]").input_value() == "Talvez", "permuta pré-preenchida")
    await shot(pg, "3a_ficha_venda_desktop")
    # prefere WhatsApp, já com nome e telefone na ficha
    await pg.locator(f + "[name=nome]").fill("Conceição")
    await pg.locator(f + "[name=telefone]").fill("21 98111-2222")
    await pg.locator(f + ".zap").click()
    await pg.wait_for_timeout(800)
    abertos = await pg.evaluate("window.__abertos")
    confere(len(abertos) == 1 and abertos[0].startswith("https://web.whatsapp.com/send?phone=5521981036246&text="), "no computador abre direto o WhatsApp Web")
    texto = urllib.parse.unquote(abertos[0].split("text=")[1])
    confere(texto.startswith("Olá, Antônio! Aqui é Conceição. Vim pelo assistente do site.\nQUERO VENDER MEU IMÓVEL"), "mensagem do WhatsApp com nome e ficha")
    confere("Imóvel: Cobertura, 3 quartos, 2 vagas, 150 m², em Icaraí" in texto and "Aceita permuta: Talvez" in texto, "dados da venda na mensagem")
    zap = [r for r in registros() if "acao=whats" in r["rota"]]
    confere(len(zap) == 1, "contato registrado no WhatsApp Lead (CRM)")
    c = campos(zap[-1]["corpo"])
    confere(c.get("nome") == "Conceição" and c.get("telefone") == "(21) 98111-2222", f"nome com acento e telefone corretos ({c.get('nome')}, {c.get('telefone')})")
    confere("%C3" not in zap[-1]["corpo"], "codificado em ISO-8859-1, como o formulário nativo")
    # segunda ida ao WhatsApp não pede os dados de novo
    await falar(pg, "prefiro whatsapp")
    await pg.locator("#quinto-chat .zap-caixa .zap").last.click()
    await pg.wait_for_timeout(500)
    confere(len(await pg.evaluate("window.__abertos")) == 2, "segunda vez abre direto (dados lembrados)")
    confere(not pg.erros, f"sem erros de JavaScript {pg.erros}")
    await pg.context.close()


CELULAR = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"

MIC_FALSO = """
window.SpeechRecognition = window.webkitSpeechRecognition = function () {
  var r = this;
  r.start = function () { setTimeout(function () {
    r.onresult({ results: [[{ transcript: "apartamento de 2 quartos em Icaraí" }]] });
    r.onend();
  }, 200); };
  r.stop = function () { r.onend && r.onend(); };
};
"""


async def cenario_v12(nav):
    print("\n[v1.2] Cartões sem lista, valores sem quebra, WhatsApp direto, microfone, valor indefinido")
    ctx = await nav.new_context(viewport={"width": 390, "height": 800}, user_agent=CELULAR, is_mobile=True, has_touch=True,
                                extra_http_headers={"X-Teste-IP": "10.9.9.9"})
    await ctx.add_init_script(INIT + MIC_FALSO)
    pg = await ctx.new_page()
    pg.erros = []
    pg.on("pageerror", lambda e: pg.erros.append(str(e)))
    await pg.goto(BASE + "/")
    # cartões no lugar da lista
    await falar(pg, "me mostra a lista de imóveis")
    baloes = await pg.evaluate(f"[...{SR}.querySelectorAll('.msg.bot')].at(-1).querySelectorAll('.balao').length")
    cartoes = await pg.evaluate(f"[...{SR}.querySelectorAll('.msg.bot')].at(-1).querySelectorAll('.imovel').length")
    texto = await pg.evaluate(f"[...{SR}.querySelectorAll('.msg.bot')].at(-1).innerText")
    confere(cartoes == 2 and baloes == 2, f"frase, 2 cartões e frase final ({baloes} balões, {cartoes} cartões)")
    confere("— Santa Rosa, 2 quartos —" not in texto, "a lista em texto não aparece")
    ordem = await pg.evaluate(f"[...[...{SR}.querySelectorAll('.msg.bot')].at(-1).children].map(e=>e.className)")
    confere(ordem[:4] == ["balao", "imovel", "imovel", "balao"], f"ordem: frase, cartões, frase ({ordem})")
    hist = await pg.evaluate("JSON.parse(sessionStorage.getItem('quintoChat.v2')).historico.at(-1).content")
    confere("#QI1626" in hist, "histórico guarda os códigos mostrados")
    await shot(pg, "v12a_cartoes_celular")
    # valores e telefone sem quebra
    await falar(pg, "quanto custa o condomínio")
    nw = await pg.evaluate(f"[...[...{SR}.querySelectorAll('.msg.bot')].at(-1).querySelectorAll('.nw')].map(e=>e.textContent)")
    confere(nw == ["R$ 1.128", "R$ 113", "(21) 98103-6246"], f"R$ e telefone sem quebra de linha ({nw})")
    # WhatsApp: nome e telefone direto
    await falar(pg, "prefiro whatsapp")
    ultima = f"[...{SR}.querySelectorAll('.msg.bot')].at(-1)"
    confere(await pg.evaluate(f"!!{ultima}.querySelector('.mini [name=nome]')"), "nome e telefone aparecem direto, sem clique a mais")
    botao = await pg.evaluate(f"{ultima}.querySelector('.mini .zap').innerText.trim()")
    confere(botao == "Enviar mensagem pelo WhatsApp", f"botão diz o que faz ({botao!r})")
    confere("mensagem pronta" in await pg.evaluate(f"{ultima}.querySelector('.mini .ajuda').innerText"), "explica que a mensagem vai pronta")
    await shot(pg, "v12b_whatsapp_direto_celular")
    await pg.locator("#quinto-chat .mini [name=nome]").last.fill("Maria")
    await pg.locator("#quinto-chat .mini [name=telefone]").last.fill("21 97777-6666")
    await pg.locator("#quinto-chat .mini .zap").last.click()
    await pg.wait_for_timeout(400)
    abertos = await pg.evaluate("window.__abertos")
    confere(len(abertos) == 1 and abertos[0].startswith("https://wa.me/5521981036246?text="), "no celular abre o aplicativo (wa.me)")
    confere(await pg.evaluate(f"!{ultima}.querySelector('.mini') && !!{ultima}.querySelector('.zap')"), "depois de enviar, fica só o botão")
    # microfone
    confere(await pg.locator("#quinto-chat .mic").is_visible(), "botão de microfone aparece")
    await pg.locator("#quinto-chat .mic").click()
    await pg.wait_for_timeout(500)
    confere(await pg.locator("#quinto-chat .entrada textarea").input_value() == "apartamento de 2 quartos em Icaraí", "a fala vira texto no campo, para conferir antes de enviar")
    await shot(pg, "v12c_microfone_celular")
    # visitante não sabe quanto pode investir
    await pg.locator("#quinto-chat .entrada textarea").fill("")
    await falar(pg, "não sei quanto posso gastar")
    f = "#quinto-chat .ficha:not(.mini) "
    confere(await pg.locator(f + "[name=faixa]").last.input_value() == "nao_sei", "ficha já marca 'Ainda não sei'")
    confere(await pg.locator(f + ".calc").last.is_visible(), "e mostra o link da calculadora")
    confere(not pg.erros, f"sem erros de JavaScript {pg.erros}")
    await ctx.close()


def ultimo_pedido():
    with urllib.request.urlopen(BASE + "/__ultimo") as r:
        return json.loads(r.read())


async def cenario_v13(nav):
    print("\n[v1.3] Ficha não repete, sugestões, WhatsApp pela ficha, título, resumo do WhatsApp")
    ctx = await nav.new_context(viewport={"width": 390, "height": 800}, user_agent=CELULAR, is_mobile=True, has_touch=True,
                                extra_http_headers={"X-Teste-IP": "10.9.9.13"})
    await ctx.add_init_script(INIT)
    pg = await ctx.new_page()
    pg.erros = []
    pg.on("pageerror", lambda e: pg.erros.append(str(e)))
    await pg.goto(BASE + "/")
    # título do cartão sem "| Quinto"
    await falar(pg, "me mostra a lista de imóveis")
    titulos = await pg.evaluate(f"[...{SR}.querySelectorAll('.imovel .titulo')].map(e=>e.textContent)")
    confere(titulos and all("| Quinto" not in t for t in titulos), f"títulos sem '| Quinto' ({titulos})")
    # ficha aberta; o "modelo" abre a mesma ficha de novo: fica só uma
    await falar(pg, "não achei o que procuro")
    confere(await pg.evaluate(f"{SR}.querySelectorAll('.ficha:not(.mini)').length") == 1, "uma ficha aberta")
    await falar(pg, "obrigado, vou encerrar")
    confere(ultimo_pedido().get("fichas") == ["ficha_busca"], f"o chat avisa o servidor que a ficha está aberta ({ultimo_pedido().get('fichas')})")
    confere(await pg.evaluate(f"{SR}.querySelectorAll('.ficha:not(.mini)').length") == 1, "a ficha repetida substitui a anterior (continua uma só)")
    confere(await pg.locator("#quinto-chat .ficha [name=bairros]").input_value() == "Icaraí", "a ficha que fica é a mais recente")
    confere(await pg.evaluate(f"{SR}.querySelector('.sugestoes').children.length") == 0, "sem sugestões por cima da ficha")
    # "Prefiro falar no WhatsApp" usa nome e telefone da própria ficha
    f = "#quinto-chat .ficha "
    await pg.locator(f + "[name=nome]").fill("Antônio Barbosa")
    await pg.locator(f + ".zap").click()
    confere(await pg.evaluate(f"{SR}.querySelectorAll('.mini').length") == 0, "não abre outro quadro de nome e telefone")
    erro = await pg.locator(f + "[data-erro=telefone]").inner_text()
    confere("para abrir o WhatsApp" in erro, f"destaca o telefone na própria ficha ({erro})")
    confere(await pg.evaluate(f"{SR}.activeElement && {SR}.activeElement.name") == "telefone", "cursor vai para o telefone")
    confere(await pg.locator(f + "[data-erro=email]").inner_text() == "", "não cobra o e-mail para o WhatsApp")
    await pg.locator(f + "[name=telefone]").fill("21 97777-6666")
    await pg.locator(f + ".zap").click()
    await pg.wait_for_timeout(300)
    abertos = await pg.evaluate("window.__abertos")
    confere(len(abertos) == 1 and "Aqui%20%C3%A9%20Ant%C3%B4nio" in abertos[0], "abre o WhatsApp com o nome da ficha")
    # recarregar a página: a ficha substituída não volta
    await pg.reload()
    await pg.locator("#quinto-chat .lancador").click()
    await pg.wait_for_timeout(300)
    confere(await pg.evaluate(f"{SR}.querySelectorAll('.ficha:not(.mini)').length") == 1, "depois de recarregar, continua uma ficha só")
    await shot(pg, "v13a_ficha_unica_celular")
    confere(not pg.erros, f"sem erros de JavaScript {pg.erros}")
    await ctx.close()

    # WhatsApp sem o "quero falar com o corretor"
    ctx = await nav.new_context(viewport={"width": 390, "height": 800}, user_agent=CELULAR, is_mobile=True, has_touch=True,
                                extra_http_headers={"X-Teste-IP": "10.9.9.14"})
    await ctx.add_init_script(INIT)
    pg = await ctx.new_page()
    await pg.goto(BASE + "/")
    await falar(pg, "só oi")
    await pg.locator("#quinto-chat .mini [name=nome]").last.fill("Maria")
    await pg.locator("#quinto-chat .mini [name=telefone]").last.fill("21 97777-6666")
    await pg.locator("#quinto-chat .mini .zap").last.click()
    await pg.wait_for_timeout(300)
    from urllib.parse import unquote
    msg = unquote((await pg.evaluate("window.__abertos"))[0].split("text=")[1])
    confere(msg == "Olá, Antônio! Aqui é Maria. Vim pelo assistente do site e gostaria de atendimento.", f"mensagem do WhatsApp limpa ({msg!r})")
    # na página de um imóvel: o código e o link vão junto
    await pg.goto(BASE + "/imovel/4383031/apartamento-venda-niteroi-rj-santa-rosa")
    await pg.evaluate("window.__abertos = []")
    await falar(pg, "só oi")
    await pg.locator("#quinto-chat .zap").last.click()
    await pg.wait_for_timeout(300)
    msg = unquote((await pg.evaluate("window.__abertos"))[0].split("text=")[1])
    confere("#QI1626" in msg and "/imovel/4383031/" in msg, f"na página do imóvel, a mensagem leva o código e o link ({msg!r})")
    # ficha de contato do imóvel -> WhatsApp: leva o link do imóvel
    await pg.evaluate("window.__abertos = []")
    await falar(pg, "quero agendar uma visita")
    f = "#quinto-chat .ficha:not(.mini) "
    await pg.locator(f + ".zap").last.click()
    await pg.wait_for_timeout(300)
    msg = unquote((await pg.evaluate("window.__abertos"))[0].split("text=")[1])
    confere("#QI1626" in msg and "/imovel/4383031/" in msg, f"ficha do imóvel pelo WhatsApp leva código e link ({msg[:120]!r})")
    await ctx.close()


async def cenario_sem_mic(nav):
    print("\n[v1.2] Navegador sem reconhecimento de voz")
    ctx = await nav.new_context(viewport={"width": 1280, "height": 900})
    await ctx.add_init_script("delete window.webkitSpeechRecognition; delete window.SpeechRecognition;")
    pg = await ctx.new_page()
    await pg.goto(BASE + "/")
    await pg.locator("#quinto-chat .lancador").click()
    confere(await pg.locator("#quinto-chat .mic").is_hidden(), "sem suporte, o botão de microfone não aparece")
    await ctx.close()


async def cenario_tag(nav):
    print("\n[4] Tag GTM WhatsApp Inteligente v3")
    if not os.path.exists(os.path.join(os.path.dirname(__file__), "..", "gtm", "whatsapp-inteligente-v3.html")):
        print("  (pulado: a pasta gtm não está neste repositório)")
        return
    pg = await nova_pagina(nav)
    await pg.goto(BASE + "/imovel/4383031/apartamento-venda-niteroi-rj-santa-rosa")
    await pg.wait_for_timeout(500)
    antes = len([r for r in registros() if "acao=whats" in r["rota"]])
    # link direto do rodapé -> mensagem personalizada
    await pg.locator("#link-rodape").click()
    abertos = await pg.evaluate("window.__abertos")
    t = urllib.parse.unquote(abertos[-1].split("text=")[1]) if abertos else ""
    confere(t.startswith("Olá, Antônio! Vi o apartamento #QI1626 de 2 quartos em Santa Rosa (na Rua Doutor Mário Viana), Niterói no site da Quinto Imóveis e gostaria de mais informações."), f"link direto com mensagem personalizada: {t!r}")
    confere(t.endswith("/imovel/4383031/apartamento-venda-niteroi-rj-santa-rosa"), "link do imóvel no fim da mensagem")
    # compartilhar não é sequestrado
    prevenido = await pg.evaluate("""(()=>{const a=document.getElementById('compartilhar');let p=null;
      document.addEventListener('click',e=>{p=e.defaultPrevented;e.preventDefault();},{once:true});
      a.click();return p;})()""")
    confere(prevenido is False and len(await pg.evaluate("window.__abertos")) == 1, "botão Compartilhar volta a funcionar normalmente")
    # botão flutuante abre a janelinha nativa
    await pg.locator("#btwhatsapp").click()
    confere(await pg.locator(".chat_window").is_visible(), "botão verde abre a janelinha do WhatsApp Lead")
    await pg.locator("#frmAPPWhats [name=nome]").fill("João Pedro")
    await pg.locator("#frmAPPWhats [name=telefone]").fill("(21) 97777-6666")
    await pg.locator("#frmAPPWhats_btnsend").click()
    await pg.wait_for_timeout(800)
    abertos = await pg.evaluate("window.__abertos")
    t = urllib.parse.unquote(abertos[-1].split("text=")[1])
    confere(t.startswith("Olá, Antônio! Aqui é João. Vi o apartamento #QI1626"), "WhatsApp Lead abre com mensagem personalizada e nome")
    zap = [r for r in registros() if "acao=whats" in r["rota"]]
    confere(len(zap) == antes + 1 and campos(zap[-1]["corpo"]).get("imovel") == "4383031", "contato gravado no CRM, ligado ao imóvel")
    confere(pg.url.endswith("santa-rosa"), "a página não sai do lugar")
    # validação nativa continua valendo
    await pg.locator("#btwhatsapp").click()
    await pg.locator("#frmAPPWhats [name=nome]").fill("Ana")
    await pg.locator("#frmAPPWhats [name=telefone]").fill("(21) 9999")
    await pg.locator("#frmAPPWhats_btnsend").click()
    await pg.wait_for_timeout(400)
    confere(len([r for r in registros() if "acao=whats" in r["rota"]]) == antes + 1, "telefone incompleto é barrado pelo próprio ImobiBrasil")
    dl = await pg.evaluate("(window.dataLayer||[]).filter(e=>e.event==='whatsapp_click').map(e=>e.whatsapp_origem)")
    confere(dl == ["link_direto", "whatsapp_lead"], f"evento whatsapp_click para o GA4 ({dl})")
    confere(not pg.erros, f"sem erros de JavaScript {pg.erros}")
    await pg.context.close()


async def balao(pg):
    return await pg.evaluate(SR + ".querySelector('.dica').hidden ? null : " + SR + ".querySelector('.dica-texto').textContent")


async def cenario_baloes(nav):
    print("\n[balões de convite]")
    # 1a. descrição chega antes dos 20 s
    pg = await nova_pagina(nav)
    await pg.goto(BASE + "/imovel/4383031/apartamento-venda-niteroi-rj-santa-rosa")
    await pg.wait_for_timeout(1500)
    confere(await balao(pg) is None, "nada aparece logo ao chegar")
    await pg.evaluate("document.getElementById('desc_descricao').scrollIntoView({block:'center'})")
    await pg.wait_for_timeout(700)
    t = await balao(pg)
    confere(t == "Gostou deste apartamento em Santa Rosa? Posso agendar uma visita ou te passar condomínio e IPTU.", f"ao chegar na descrição: balão do imóvel ({t})")
    await shot(pg, "balao-computador")
    # clicar abre o chat continuando o assunto
    await pg.evaluate(SR + ".querySelector('.dica').click()")
    await pg.wait_for_timeout(300)
    msgs = await pg.evaluate("[..." + SR + ".querySelectorAll('.msg.bot .balao')].map(e=>e.textContent)")
    sug = await pg.evaluate("[..." + SR + ".querySelectorAll('.sugestoes button')].map(e=>e.textContent)")
    confere(len(msgs) == 1 and "agendar uma visita a este apartamento" in msgs[0], f"clique no balão abre o chat no mesmo assunto ({msgs})")
    confere(sug == ["Quero agendar uma visita", "Qual o condomínio e o IPTU?", "Tem opções parecidas?"], "sugestões do balão aparecem")
    dl = await pg.evaluate("(window.dataLayer||[]).filter(e=>e.event==='quinto_chat').map(e=>e.quinto_chat_acao)")
    confere("balao_exibido" in dl and "balao_clicado" in dl, f"eventos do balão no GA4 ({dl})")
    # depois de abrir o chat, nenhum balão nas próximas páginas
    await pg.goto(BASE + "/imovel/4378274/apartamento-venda-niteroi-rj-icarai?balao=1")
    await pg.wait_for_timeout(2000)
    confere(await balao(pg) is None, "depois de abrir o chat, não aparece mais balão")
    await pg.context.close()

    # 1b. sem rolar: aparece pelo tempo (aqui 2 s no lugar de 20 s)
    pg = await nova_pagina(nav, 390, 800)
    await pg.goto(BASE + "/imovel/4383031/apartamento-venda-niteroi-rj-santa-rosa?balao=2")
    await pg.wait_for_timeout(1200)
    confere(await balao(pg) is None, "antes do tempo, nada")
    await pg.wait_for_timeout(1500)
    confere((await balao(pg) or "").startswith("Gostou deste apartamento"), "sem rolar, aparece pelo tempo (celular)")
    caixa = await pg.evaluate("(()=>{const d=" + SR + ".querySelector('.dica').getBoundingClientRect(); const z=document.getElementById('btwhatsapp').getBoundingClientRect(); const l=" + SR + ".querySelector('.lancador').getBoundingClientRect(); const sobre=(a,b)=>!(a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top); return {zap:sobre(d,z), botao:sobre(d,l), dentro: d.left>=0 && d.right<=innerWidth}})()")
    confere(caixa == {"zap": False, "botao": False, "dentro": True}, f"no celular o balão não cobre o WhatsApp nem o botão do chat ({caixa})")
    await shot(pg, "balao-celular")
    # 2. terceiro imóvel: convite para a busca personalizada
    await pg.goto(BASE + "/imovel/1111111/apartamento-venda-niteroi-rj-inga?balao=1")
    await pg.wait_for_timeout(1600)
    await pg.goto(BASE + "/imovel/2222222/apartamento-venda-niteroi-rj-centro?balao=1")
    await pg.wait_for_timeout(1600)
    t = await balao(pg)
    confere(t == "Ainda não achou o ideal? Me diga o que procura que o corretor Antônio Quinto busca no mercado para você.", f"no 3º imóvel: convite para a busca ({t})")
    # limite de 3 por visita
    await pg.goto(BASE + "/imovel/3333333/apartamento-venda-niteroi-rj-centro?balao=1")
    await pg.wait_for_timeout(1600)
    confere(await balao(pg) is None, "limite de 3 balões por visita")
    await pg.context.close()

    # 3. fechar no X encerra os convites; aviso de cookies segura o balão
    pg = await nova_pagina(nav)
    await pg.add_init_script("document.addEventListener('DOMContentLoaded',()=>{const a=document.createElement('div');a.id='aviso_privacidade';a.style.cssText='position:fixed;bottom:60px;left:20px;right:20px;height:60px;background:#222;display:flex';document.body.appendChild(a);})")
    await pg.goto(BASE + "/imovel/4383031/apartamento-venda-niteroi-rj-santa-rosa?balao=1")
    await pg.wait_for_timeout(2000)
    confere(await balao(pg) is None, "com o aviso de cookies na tela, o balão espera")
    await pg.evaluate("document.getElementById('aviso_privacidade').style.display='none'")
    await pg.wait_for_timeout(1300)
    confere(await balao(pg) is not None, "aviso aceito: o balão aparece")
    await pg.evaluate(SR + ".querySelector('.fechar-dica').click()")
    await pg.goto(BASE + "/imovel/1111111/apartamento-venda-niteroi-rj-inga?balao=1")
    await pg.wait_for_timeout(1800)
    confere(await balao(pg) is None, "fechou no X: nenhum outro balão na visita")
    await pg.context.close()

    # 4. saída (computador) e quem já chamou no WhatsApp
    pg = await nova_pagina(nav)
    await pg.goto(BASE + "/")
    await pg.wait_for_timeout(5300)
    await pg.mouse.move(600, 300)
    await pg.mouse.move(600, -5)
    await pg.evaluate("document.dispatchEvent(new MouseEvent('mouseout',{clientY:-1,relatedTarget:null,bubbles:true}))")
    await pg.wait_for_timeout(300)
    t = await balao(pg)
    confere(t == "Antes de ir: quer que eu te avise de imóveis parecidos?", f"intenção de saída no computador ({t})")
    await pg.context.close()
    pg = await nova_pagina(nav)
    await pg.goto(BASE + "/imovel/4383031/apartamento-venda-niteroi-rj-santa-rosa?balao=2")
    await pg.locator("#btwhatsapp").click()
    await pg.locator("#frmAPPWhats [name=nome]").fill("Teste")
    await pg.locator("#frmAPPWhats [name=telefone]").fill("(21) 97777-6666")
    await pg.locator("#frmAPPWhats_btnsend").click()
    await pg.wait_for_timeout(2600)
    confere(await balao(pg) is None, "quem já mandou WhatsApp não recebe convite")
    confere(not pg.erros, f"sem erros de JavaScript {pg.erros}")
    await pg.context.close()


async def cenario_conversa_longa(nav):
    print("\n[conversa longa: empurrão e limite de 15 mensagens]")
    pg = await nova_pagina(nav, 390, 800)
    enviados = []
    pg.on("request", lambda r: enviados.append(json.loads(r.post_data)) if r.url.endswith("/chat") and r.method == "POST" else None)
    await pg.goto(BASE + "/")
    for i in range(1, 16):
        await falar(pg, f"pergunta numero {i} sobre apartamentos")
    rodadas = [e.get("rodada") for e in enviados]
    confere(rodadas == list(range(1, 16)), f"o chat informa o número da mensagem ({rodadas[:3]}...{rodadas[-1:]})")
    confere(all(e.get("contato") is False for e in enviados), "e que ainda não houve contato")
    confere(await pg.locator("#quinto-chat .entrada textarea").is_disabled(), "depois da 15ª o campo de mensagem trava")
    f = "#quinto-chat .ficha "
    titulo = await pg.locator(f + ".ficha-titulo").inner_text()
    confere(titulo.strip() == "Falar com o corretor", f"ficha para falar com o corretor ({titulo.strip()})")
    msg = await pg.locator(f + "[name=mensagem]").input_value()
    confere(msg.startswith("Conversei com o assistente do site e quero falar com o corretor.\nO que eu procuro: pergunta numero 12"), "mensagem com o resumo do que a pessoa perguntou")
    zap = await pg.evaluate("[..." + SR + ".querySelectorAll('.zap')].map(b=>b.textContent.trim())")
    confere(zap == ["Prefiro falar no WhatsApp"], f"botão do WhatsApp na ficha ({zap})")
    dl = await pg.evaluate("(window.dataLayer||[]).filter(e=>e.event==='quinto_chat').map(e=>e.quinto_chat_acao)")
    confere("limite_conversa" in dl, "evento limite_conversa no GA4")
    await shot(pg, "limite_conversa_celular")
    # nova mensagem não sai mais
    antes = len(enviados)
    await pg.evaluate(SR + ".querySelector('.entrada textarea').disabled=false")
    await pg.locator("#quinto-chat .entrada textarea").fill("mais uma")
    await pg.keyboard.press("Enter")
    await pg.wait_for_timeout(500)
    confere(len(enviados) == antes, "nenhuma chamada nova à IA depois do limite")
    # a ficha leva ao Fale Conosco
    await pg.locator(f + "[name=nome]").fill("Paula Souza")
    await pg.locator(f + "[name=telefone]").type("21988887777")
    await pg.locator(f + "[name=email]").fill("paula@exemplo.com")
    await pg.locator(f + ".enviar-ficha").click()
    await pg.wait_for_url("**/contato", timeout=5000)
    await pg.wait_for_timeout(900)
    m = await pg.locator("#frmContato [name=mensagem]").input_value()
    confere(m.startswith("Conversei com o assistente do site"), "Fale Conosco preenchido com o resumo")
    await pg.locator("#quinto-chat .lancador").click()
    confere(await pg.locator("#quinto-chat .entrada textarea").is_disabled(), "em outra página o chat continua encerrado")
    confere(not pg.erros, f"sem erros de JavaScript {pg.erros}")
    await pg.context.close()


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        for c in (cenario_busca, cenario_imovel, cenario_venda_e_whatsapp, cenario_tag, cenario_baloes, cenario_conversa_longa, cenario_v12, cenario_v13, cenario_sem_mic):
            try:
                await c(nav)
            except Exception as e:  # noqa: BLE001
                falhas.append(f"{c.__name__}: {e}")
                print("  ERRO", c.__name__, e)
        await nav.close()
    print(f"\n{'TUDO CERTO' if not falhas else str(len(falhas)) + ' FALHA(S)'}")
    sys.exit(1 if falhas else 0)


asyncio.run(main())
