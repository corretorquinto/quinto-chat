/*!
 * Quinto Chat - widget de atendimento do quintoimoveis.com.br
 * Instalação (uma linha no campo de scripts do cabeçalho do ImobiBrasil):
 * <script src="https://corretorquinto.github.io/quinto-chat/widget/quinto-chat.js" data-api="https://quinto-chat.SEU-USUARIO.workers.dev" defer></script>
 *
 * Opções (atributos data- na mesma tag):
 *   data-api          endereço do Worker (obrigatório)
 *   data-cor          cor principal (padrão #E40951, o rosa da marca)
 *   data-posicao      "esquerda" ou "direita" (padrão direita: o botão de WhatsApp do ImobiBrasil fica no canto esquerdo)
 *   data-whatsapp     número com DDI e DDD (padrão 5521981036246)
 *   data-balao-segundos  tempo até o balão de convite aparecer (padrão 20)
 *   data-calculadora  endereço da calculadora de financiamento (padrão: o que vem do Worker, ou /calculadora-financiamento)
 *
 * Os contatos são entregues pelos formulários NATIVOS do ImobiBrasil, para cair no CRM:
 *   ficha de busca e ficha de venda -> Fale Conosco (/contato)
 *   interesse num imóvel            -> formulário "Fale agora conosco" da página do imóvel
 *   WhatsApp                        -> WhatsApp Lead (registra nome e telefone) e abre o WhatsApp
 * O chat preenche os formulários; o código anti-robô de 4 números o próprio visitante digita.
 */
(function () {
  "use strict";
  if (window.__quintoChat) return;
  window.__quintoChat = true;

  var script = document.currentScript || document.querySelector("script[data-api][src*='quinto-chat']");
  var cfg = {
    api: ((script && script.getAttribute("data-api")) || "").replace(/\/+$/, ""),
    cor: (script && script.getAttribute("data-cor")) || "#E40951",
    posicao: (script && script.getAttribute("data-posicao")) === "esquerda" ? "esquerda" : "direita",
    whatsapp: (script && script.getAttribute("data-whatsapp")) || "5521981036246",
    balaoSegundos: Number(script && script.getAttribute("data-balao-segundos")) || 20,
    calculadora: (script && script.getAttribute("data-calculadora")) || "https://www.quintoimoveis.com.br/calculadora-financiamento",
  };
  if (!cfg.api) {
    console.warn("[Quinto Chat] falta o atributo data-api na tag do script");
    return;
  }

  var CHAVE = "quintoChat.v2";
  var CHAVE_ENTREGA = "quintoChat.entrega";
  var MAX_HISTORICO = 16;
  var LIMITE_CONVERSA = 15; // mensagens do visitante por visita; depois, só o corretor
  var VALIDADE_ENTREGA = 20 * 60 * 1000;
  var naPaginaDeImovel = /\/imovel\/\d+\//.test(location.pathname);

  // ---------- estado (fica salvo enquanto a aba estiver aberta) ----------
  var estado = ler(CHAVE) || { historico: [], vistas: [], dicaVista: false, contato: null };
  function ler(chave) {
    try {
      return JSON.parse(sessionStorage.getItem(chave));
    } catch (e) {
      return null;
    }
  }
  function gravar(chave, valor) {
    try {
      if (valor === null) sessionStorage.removeItem(chave);
      else sessionStorage.setItem(chave, JSON.stringify(valor));
    } catch (e) {}
  }
  function salvar() {
    gravar(CHAVE, estado);
  }

  function medir(acao, extra) {
    try {
      window.dataLayer = window.dataLayer || [];
      var ev = { event: "quinto_chat", quinto_chat_acao: acao };
      for (var k in extra || {}) ev[k] = extra[k];
      window.dataLayer.push(ev);
    } catch (e) {}
  }

  // ---------- montagem ----------
  var host = document.createElement("div");
  host.id = "quinto-chat";
  var raiz = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
  var lado = cfg.posicao === "direita" ? "right" : "left";

  raiz.innerHTML =
    "<style>" + css() + "</style>" +
    '<button class="lancador" type="button" aria-label="Abrir assistente virtual" aria-expanded="false">' +
    icone("chat") + "</button>" +
    '<div class="dica" role="status" hidden><button class="fechar-dica" type="button" aria-label="Fechar">×</button>' +
    '<div class="dica-avatar" aria-hidden="true">Q</div><div class="dica-corpo"><span class="dica-texto"></span>' +
    '<span class="dica-acao">Conversar agora ›</span></div></div>' +
    '<div class="guia" role="status" hidden><button class="fechar-guia" type="button" aria-label="Fechar">×</button><strong>Falta só um passo</strong><span>Seus dados já estão no formulário. Digite o <b>código de 4 números</b> que aparece ao lado do campo destacado e toque em <b>Enviar</b>.</span></div>' +
    '<section class="painel" role="dialog" aria-label="Assistente virtual da Quinto Imóveis" hidden>' +
    '<header><div class="avatar">Q</div><div class="titulos"><strong>Quinto Imóveis</strong>' +
    "<span>Assistente virtual · responde na hora</span></div>" +
    '<button class="fechar" type="button" aria-label="Fechar">' + icone("x") + "</button></header>" +
    '<div class="mensagens" aria-live="polite"></div>' +
    '<div class="sugestoes"></div>' +
    '<form class="entrada"><textarea rows="1" maxlength="800" placeholder="Escreva sua mensagem" aria-label="Sua mensagem"></textarea>' +
    '<button type="button" class="mic" aria-label="Falar em vez de digitar" title="Falar em vez de digitar" hidden>' + icone("mic") + "</button>" +
    '<button type="submit" class="enviar" aria-label="Enviar">' + icone("enviar") + "</button></form>" +
    '<p class="aviso">Assistente com inteligência artificial; pode errar. Confirme os dados com o corretor.</p>' +
    "</section>";

  var $ = function (s) {
    return raiz.querySelector(s);
  };
  var lancador = $(".lancador"),
    painel = $(".painel"),
    lista = $(".mensagens"),
    sugestoes = $(".sugestoes"),
    form = $(".entrada"),
    campo = $(".entrada textarea"),
    botaoEnviar = $(".entrada .enviar"),
    botaoMic = $(".entrada .mic"),
    dica = $(".dica"),
    guia = $(".guia");

  function iniciar() {
    document.body.appendChild(host);
    if (!estado.vistas.length) {
      estado.vistas.push({
        de: "bot",
        texto: naPaginaDeImovel
          ? "Olá! Sou o assistente virtual da Quinto Imóveis. Quer saber algo sobre este imóvel, agendar uma visita ou ver opções parecidas?"
          : "Olá! Sou o assistente virtual da Quinto Imóveis. Posso te ajudar a encontrar um imóvel pronto à venda em Niterói, ou a vender o seu. Como posso ajudar?",
      });
    }
    estado.vistas.forEach(desenhar);
    mostrarSugestoes();
    // depois que o visitante já abriu o chat, o botão para de pular
    if (estado.abriu) lancador.classList.add("calmo");
    if (estado.encerrada) {
      travar(true);
      campo.placeholder = "Continue com o corretor acima";
      sugestoes.innerHTML = "";
    }
    var entregou = aplicarEntrega();
    if (entregou) {
      estado.chamou = true;
      salvar();
    }
    vigiarContatos();
    if (!entregou) prepararBaloes();
  }

  // ---------- abrir e fechar ----------
  function abrir() {
    if (balaoAtual && !dica.hidden) return abrirPeloBalao();
    painel.hidden = false;
    lancador.hidden = true;
    dica.hidden = true;
    lancador.setAttribute("aria-expanded", "true");
    lancador.classList.add("calmo");
    estado.abriu = true;
    estado.dicaVista = true;
    salvar();
    rolar();
    setTimeout(function () {
      campo.focus();
    }, 50);
    medir("abrir");
  }
  function fechar() {
    painel.hidden = true;
    lancador.hidden = false;
    lancador.setAttribute("aria-expanded", "false");
  }
  lancador.addEventListener("click", abrir);
  $(".fechar").addEventListener("click", function () {
    fechar();
    lancador.focus();
  });
  dica.addEventListener("click", function (e) {
    if (e.target.classList.contains("fechar-dica")) {
      // fechou no X: nenhum outro balão nesta visita
      estado.baloesFechados = true;
      salvar();
      dica.hidden = true;
      if (balaoAtual) medir("balao_fechado", { quinto_chat_balao: balaoAtual.id });
      balaoAtual = null;
      return;
    }
    abrirPeloBalao();
  });
  $(".fechar-guia").addEventListener("click", function () {
    guia.hidden = true;
  });
  painel.addEventListener("keydown", function (e) {
    if (e.key === "Escape") fechar();
  });

  // ---------- conversa ----------
  campo.addEventListener("input", ajustarAltura);
  campo.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit ? form.requestSubmit() : enviar();
    }
  });
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    enviar();
  });

  // ---------- microfone: o navegador transforma a fala em texto (sem custo de API) ----------
  // Funciona no Chrome, Edge, Android e Safari recente. Onde não houver suporte, o botão não aparece.
  var Reconhecimento = window.SpeechRecognition || window.webkitSpeechRecognition;
  var rec = null;
  var gravando = false;
  var placeholderPadrao = campo.placeholder;
  if (Reconhecimento && window.isSecureContext !== false) botaoMic.hidden = false;

  function avisoMic(texto) {
    campo.placeholder = texto;
    setTimeout(function () {
      if (campo.placeholder === texto) campo.placeholder = placeholderPadrao;
    }, 5000);
  }
  function pararMic() {
    if (rec && gravando) {
      try {
        rec.stop();
      } catch (e) {}
    }
  }
  botaoMic.addEventListener("click", function () {
    if (gravando) return pararMic();
    var base = campo.value ? campo.value.replace(/\s*$/, " ") : "";
    try {
      rec = new Reconhecimento();
    } catch (e) {
      botaoMic.hidden = true;
      return;
    }
    rec.lang = "pt-BR";
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    rec.onresult = function (ev) {
      var t = "";
      for (var i = 0; i < ev.results.length; i++) t += ev.results[i][0].transcript;
      campo.value = (base + t).slice(0, 800);
      ajustarAltura();
    };
    rec.onerror = function (ev) {
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") avisoMic("Permita o microfone no navegador para falar");
      else if (ev.error === "no-speech") avisoMic("Não ouvi nada. Toque no microfone e fale de novo");
      else if (ev.error !== "aborted") avisoMic("Não consegui ouvir agora. Pode digitar?");
    };
    rec.onend = function () {
      gravando = false;
      botaoMic.classList.remove("gravando");
      botaoMic.setAttribute("aria-label", "Falar em vez de digitar");
      if (campo.placeholder === "Pode falar, estou ouvindo...") campo.placeholder = placeholderPadrao;
      if (!campo.disabled) campo.focus();
    };
    try {
      rec.start();
    } catch (e) {
      return;
    }
    gravando = true;
    botaoMic.classList.add("gravando");
    botaoMic.setAttribute("aria-label", "Parar de gravar");
    campo.placeholder = "Pode falar, estou ouvindo...";
    medir("microfone");
  });

  var ocupado = false;
  function enviar(textoPronto) {
    var texto = (textoPronto || campo.value).trim();
    if (!texto || ocupado) return;
    pararMic();
    if ((estado.rodada || 0) >= LIMITE_CONVERSA) return encerrar();
    ocupado = true;
    estado.rodada = (estado.rodada || 0) + 1;
    campo.value = "";
    ajustarAltura();
    sugestoes.innerHTML = "";
    adicionar({ de: "eu", texto: texto });
    estado.historico.push({ role: "user", content: texto });
    medir("mensagem");
    travar(true);
    var digitando = mostrarDigitando();

    var controle = window.AbortController ? new AbortController() : null;
    var tempo = setTimeout(function () {
      if (controle) controle.abort();
    }, 45000);

    fetch(cfg.api + "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mensagens: estado.historico.slice(-MAX_HISTORICO),
        pagina: { url: location.href, titulo: document.title },
        rodada: estado.rodada,
        contato: !!(estado.chamou || estado.contato),
      }),
      signal: controle ? controle.signal : undefined,
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        var acao = d.acao && d.acao.tipo ? d.acao : null;
        var completo = d.historico || d.texto;
        if (completo && !d.erro) estado.historico.push({ role: "assistant", content: completo });
        if (d.erro) estado.historico.pop(); // permite tentar de novo sem repetir a pergunta
        if (acao && acao.tipo !== "whatsapp") medir("ficha_aberta", { quinto_chat_tipo: acao.tipo });
        if (d.limite) return encerrar();
        var imoveis = d.imoveis || [];
        adicionar({
          de: "bot",
          texto: d.texto || (imoveis.length ? "" : "Desculpe, não consegui responder agora."),
          textoDepois: d.texto_depois || "",
          imoveis: imoveis,
          acao: acao,
        });
      })
      .catch(function () {
        estado.historico.pop();
        adicionar({
          de: "bot",
          texto: "Não consegui me conectar agora. Você pode falar direto com o corretor Antônio Quinto pelo WhatsApp, o atendimento é 24 horas.",
          acao: { tipo: "whatsapp", texto: "Olá, Antônio! Vim pelo site e gostaria de atendimento." },
        });
      })
      .then(function () {
        clearTimeout(tempo);
        digitando.remove();
        travar(false);
        ocupado = false;
        if (estado.rodada >= LIMITE_CONVERSA) return encerrar();
        if (!painel.hidden) campo.focus();
      });
  }

  // ---------- fim da conversa (15 mensagens): o corretor continua o atendimento ----------
  function resumoDaConversa() {
    var falas = estado.historico
      .filter(function (m) { return m.role === "user"; })
      .map(function (m) { return m.content; })
      .slice(-4)
      .join(" / ");
    return falas.length > 500 ? falas.slice(0, 497) + "..." : falas;
  }

  function encerrar() {
    travar(true);
    campo.placeholder = "Continue com o corretor acima";
    sugestoes.innerHTML = "";
    if (estado.encerrada) return;
    estado.encerrada = true;
    var resumo = resumoDaConversa();
    var idImovel = (location.pathname.match(/\/imovel\/(\d+)\//) || [])[1];
    var mensagem = "Conversei com o assistente do site e quero falar com o corretor." + (resumo ? "\nO que eu procuro: " + resumo : "");
    var acao = idImovel
      ? { tipo: "contato_imovel", id: idImovel, url: location.pathname, codigo: "", mensagem: mensagem.slice(0, 790) }
      : { tipo: "contato_geral", mensagem: mensagem.slice(0, 790) };
    estado.historico.push({ role: "assistant", content: "[Conversa encerrada pelo limite; visitante encaminhado ao corretor.]" });
    adicionar({
      de: "bot",
      texto: "Nossa conversa já está bem completa! Para continuar, o corretor Antônio Quinto atende você pessoalmente. Complete seus dados e toque em Enviar, ou, se preferir, chame no WhatsApp:",
      acao: acao,
    });
    medir("limite_conversa");
  }

  function travar(sim) {
    campo.disabled = sim;
    botaoEnviar.disabled = sim;
    botaoMic.disabled = sim;
    if (sim) pararMic();
  }

  // ---------- desenho das mensagens ----------
  function adicionar(msg) {
    estado.vistas.push(msg);
    if (estado.vistas.length > 60) estado.vistas = estado.vistas.slice(-60);
    if (estado.historico.length > 40) estado.historico = estado.historico.slice(-40);
    salvar();
    var bloco = desenhar(msg);
    // resposta longa (cartões, ficha): mostra o começo, não o fim
    if (msg.de === "bot" && bloco.offsetHeight > lista.clientHeight * 0.7) lista.scrollTop = bloco.offsetTop - 12;
    else rolar();
  }

  function desenhar(msg) {
    var bloco = document.createElement("div");
    bloco.className = "msg " + (msg.de === "eu" ? "eu" : "bot");
    if (msg.texto) bloco.appendChild(balaoDe(msg.texto));

    (msg.imoveis || []).forEach(function (i) {
      bloco.appendChild(cartao(i));
    });
    if (msg.textoDepois) bloco.appendChild(balaoDe(msg.textoDepois));

    var a = msg.acao;
    if (a && a.tipo === "whatsapp") {
      bloco.appendChild(botaoZap(a.texto || "", msg.zapRotulo, msg.zapSecundario));
    } else if (a && FICHAS[a.tipo] && !a.feito) {
      bloco.classList.add("largo");
      bloco.appendChild(montarFicha(msg));
    }
    lista.appendChild(bloco);
    return bloco;
  }

  function balaoDe(texto) {
    var balao = document.createElement("div");
    balao.className = "balao";
    balao.innerHTML = formatar(texto);
    return balao;
  }

  function cartao(i) {
    var el = document.createElement("a");
    el.className = "imovel";
    el.href = i.url;
    el.target = "_blank";
    el.rel = "noopener";
    var detalhes = [i.bairro, i.quartos ? i.quartos + (i.quartos > 1 ? " quartos" : " quarto") : "", i.area ? Math.round(i.area) + " m²" : "", i.vagas ? i.vagas + (i.vagas > 1 ? " vagas" : " vaga") : ""]
      .filter(Boolean)
      .join(" · ");
    el.innerHTML =
      (i.foto ? '<img src="' + esc(i.foto) + '" alt="" loading="lazy">' : '<div class="sem-foto">' + icone("casa") + "</div>") +
      '<div class="info"><span class="codigo">#' + esc(i.codigo) + "</span>" +
      '<strong class="titulo">' + esc(i.titulo) + "</strong>" +
      '<span class="detalhes">' + esc(detalhes) + "</span>" +
      '<span class="preco">' + (i.preco ? reais(i.preco) : "Consulte") + "</span></div>";
    el.addEventListener("click", function () {
      medir("imovel", { quinto_chat_codigo: i.codigo });
    });
    return el;
  }

  function mostrarDigitando() {
    var d = document.createElement("div");
    d.className = "msg bot";
    d.innerHTML = '<div class="balao digitando" aria-label="Digitando"><i></i><i></i><i></i></div>';
    lista.appendChild(d);
    rolar();
    return d;
  }

  function mostrarSugestoes(lista) {
    if (estado.historico.length && !lista) return;
    var opcoes = lista ? lista : naPaginaDeImovel
      ? ["Qual o valor do condomínio?", "Quero agendar uma visita", "Tem opções parecidas?", "Quero vender meu imóvel"]
      : ["Apartamento em Icaraí", "Não achei o imóvel que procuro", "Quero vender meu imóvel", "Falar com o corretor"];
    sugestoes.innerHTML = "";
    opcoes.forEach(function (t) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = t;
      b.addEventListener("click", function () {
        enviar(t);
      });
      sugestoes.appendChild(b);
    });
  }

  // ======================================================================
  // Balões que convidam para a conversa
  //   1. página de imóvel: ao chegar na descrição OU após 20 s (o que vier primeiro)
  //   2. a partir do 3º imóvel visto sem contato: oferece a busca personalizada
  //   3. saída (só computador): quando o mouse vai fechar a aba
  //   demais páginas: convite geral após 20 s
  // Limites: 1 por página, 3 por visita; nenhum depois que a pessoa fecha no X,
  // abre o chat ou já falou com o Antônio; nenhum com o aviso de cookies na tela.
  // ======================================================================
  var TEMPO_BALAO = cfg.balaoSegundos * 1000;
  var MAX_BALOES = 3;
  var balaoAtual = null;
  var baloesNestaPagina = 0;
  var carregouEm = Date.now();

  function infoDoImovel() {
    var t = (document.title || "").replace(/\s*\|.*$/, "");
    var m = t.match(/^(apartamento|casa|cobertura|sala comercial|sala|loja|kitnet|studio|flat|terreno|lote|galpão|chácara|sítio|fazenda|pousada|prédio)/i);
    var b = t.match(/\sem\s([^,|]+?)\s*$/);
    var tipo = m ? m[1].toLowerCase() : "";
    var fem = /^(casa|cobertura|sala|loja|kitnet|chácara|fazenda|pousada)/.test(tipo);
    var bairro = b && b[1].length <= 30 ? b[1] : "";
    return { tipo: tipo, fem: fem, bairro: bairro };
  }

  function montarBalao(id) {
    var ola = "Olá! Sou o assistente virtual da Quinto Imóveis. ";
    if (id === "imovel") {
      var i = infoDoImovel();
      var este = i.tipo ? (i.fem ? "desta " : "deste ") + i.tipo + (i.bairro ? " em " + i.bairro : "") : "deste imóvel";
      var esse = i.tipo ? (i.fem ? "a esta " : "a este ") + i.tipo : "a este imóvel";
      return {
        id: id,
        texto: "Gostou " + este + "? Posso agendar uma visita ou te passar condomínio e IPTU.",
        chat: ola + "Posso agendar uma visita " + esse + ", passar condomínio e IPTU ou mostrar opções parecidas. O que prefere?",
        sugestoes: ["Quero agendar uma visita", "Qual o condomínio e o IPTU?", "Tem opções parecidas?"],
      };
    }
    if (id === "tres_imoveis") {
      return {
        id: id,
        texto: "Ainda não achou o ideal? Me diga o que procura que o corretor Antônio Quinto busca no mercado para você.",
        chat: ola + "Me conte o que você procura (tipo, bairro, quartos, valor) e o corretor Antônio Quinto busca no mercado para você, inclusive imóveis que ainda não estão anunciados.",
        sugestoes: ["Não achei o imóvel que procuro", "Quero ver outras opções", "Falar com o corretor"],
      };
    }
    if (id === "saida") {
      return {
        id: id,
        texto: "Antes de ir: quer que eu te avise de imóveis parecidos?",
        chat: ola + "Antes de você ir: o corretor Antônio Quinto pode te avisar quando aparecer um imóvel parecido com o que você procura. É só me dizer o que procura.",
        sugestoes: ["Quero ser avisado de imóveis parecidos", "Não achei o imóvel que procuro", "Falar com o corretor"],
      };
    }
    return {
      id: "geral",
      texto: "Procurando imóvel em Niterói? Posso ajudar.",
      chat: ola + "Posso te ajudar a encontrar um imóvel pronto à venda em Niterói, ou a vender o seu. Como posso ajudar?",
      sugestoes: ["Apartamento em Icaraí", "Não achei o imóvel que procuro", "Quero vender meu imóvel", "Falar com o corretor"],
    };
  }

  function podeMostrarBalao() {
    return (
      !estado.abriu && !estado.baloesFechados && !estado.chamou &&
      (estado.baloes || 0) < MAX_BALOES && baloesNestaPagina < 1 &&
      painel.hidden && guia.hidden
    );
  }

  function cookiesNaTela() {
    var a = document.getElementById("aviso_privacidade");
    if (!a) return false;
    var st = getComputedStyle(a);
    return st.display !== "none" && st.visibility !== "hidden" && a.offsetHeight > 0;
  }

  // espera = true: se o aviso de cookies estiver na tela, aguarda ele sumir
  function mostrarBalao(id, espera) {
    if (!podeMostrarBalao()) return;
    if (cookiesNaTela()) {
      if (espera) setTimeout(function () { mostrarBalao(id, true); }, 1000);
      return;
    }
    balaoAtual = montarBalao(id);
    baloesNestaPagina++;
    estado.baloes = (estado.baloes || 0) + 1;
    salvar();
    dica.querySelector(".dica-texto").textContent = balaoAtual.texto;
    dica.hidden = false;
    medir("balao_exibido", { quinto_chat_balao: balaoAtual.id });
    // some sozinho depois de 25 s (sem contar como fechado)
    var este = balaoAtual;
    setTimeout(function () {
      if (balaoAtual === este) dica.hidden = true;
    }, 25000);
  }

  function abrirPeloBalao() {
    var b = balaoAtual;
    balaoAtual = null;
    dica.hidden = true;
    if (!b) return abrir();
    medir("balao_clicado", { quinto_chat_balao: b.id });
    // sem conversa ainda: a mensagem do balão vira a saudação
    if (!estado.historico.length) {
      estado.vistas = [];
      lista.innerHTML = "";
    }
    abrir();
    adicionar({ de: "bot", texto: b.chat });
    mostrarSugestoes(b.sugestoes);
  }

  function prepararBaloes() {
    var idImovel = (location.pathname.match(/\/imovel\/(\d+)\//) || [])[1];
    if (idImovel) {
      estado.imoveisVistos = estado.imoveisVistos || [];
      if (estado.imoveisVistos.indexOf(idImovel) < 0) estado.imoveisVistos.push(idImovel);
      if (estado.imoveisVistos.length > 50) estado.imoveisVistos = estado.imoveisVistos.slice(-50);
      salvar();
    }
    if (!podeMostrarBalao()) return;

    // a partir do 3º imóvel, o convite é para a busca personalizada (uma vez por visita)
    var idPagina = "geral";
    if (idImovel) {
      idPagina = estado.imoveisVistos.length >= 3 && !estado.ofereceuBusca ? "tres_imoveis" : "imovel";
    }
    var disparou = false;
    function disparar() {
      if (disparou) return;
      disparou = true;
      if (idPagina === "tres_imoveis") {
        estado.ofereceuBusca = true;
        salvar();
      }
      mostrarBalao(idPagina, true);
    }

    // o que vier primeiro: chegar na descrição ou 20 s na página
    setTimeout(disparar, TEMPO_BALAO);
    var desc = idImovel && (document.getElementById("desc_descricao") || acharDescricao());
    if (desc && window.IntersectionObserver) {
      var obs = new IntersectionObserver(function (itens) {
        if (itens.some(function (x) { return x.isIntersecting; })) {
          obs.disconnect();
          disparar();
        }
      }, { rootMargin: "0px 0px -35% 0px" });
      obs.observe(desc);
    }

    // saída: só em computador com mouse
    var temMouse = window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (temMouse && window.innerWidth > 640) {
      document.addEventListener("mouseout", function (e) {
        if (e.relatedTarget || e.clientY > 0) return;
        if (Date.now() - carregouEm < 5000) return;
        mostrarBalao("saida", false);
      });
    }
  }

  function acharDescricao() {
    var hs = document.querySelectorAll("h2,h3");
    for (var i = 0; i < hs.length; i++) if (/descri[çc][ãa]o/i.test(hs[i].textContent)) return hs[i];
    return null;
  }

  // quem já falou com o Antônio (formulário, WhatsApp) não recebe mais convites
  function vigiarContatos() {
    document.addEventListener("submit", function (e) {
      var f = e.target;
      if (f && /^(frmcon1|frmemi|frmContato|frmAPPWhats)$/.test(f.getAttribute("name") || f.id || "")) {
        estado.chamou = true;
        salvar();
        dica.hidden = true;
      }
    }, true);
    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest("a[href*='wa.me'],a[href*='api.whatsapp'],a[href*='web.whatsapp']");
      if (a && a.getAttribute("href").indexOf(cfg.whatsapp) >= 0) {
        estado.chamou = true;
        salvar();
        dica.hidden = true;
      }
    }, true);
  }

  // ======================================================================
  // WhatsApp: registra no WhatsApp Lead nativo (CRM) e abre a conversa
  // ======================================================================
  // Se já sabemos nome e telefone: só o botão. Se não: nome e telefone direto, com o botão logo abaixo.
  function botaoZap(texto, rotulo, secundario) {
    var caixa = document.createElement("div");
    caixa.className = "zap-caixa";
    var c = estado.contato;
    if (c && c.nome && c.telefone) caixa.appendChild(soBotaoZap(texto, rotulo, secundario));
    else
      caixa.appendChild(
        miniZap(texto, function (f) {
          caixa.replaceChild(soBotaoZap(texto, rotulo, secundario), f);
        })
      );
    return caixa;
  }

  function soBotaoZap(texto, rotulo, secundario) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "zap" + (secundario ? " secundario" : "");
    b.innerHTML = icone("whatsapp") + "<span>" + esc(rotulo || "Enviar mensagem pelo WhatsApp") + "</span>";
    b.addEventListener("click", function () {
      abrirWhatsApp(texto, estado.contato || {});
    });
    return b;
  }

  function miniZap(texto, depois) {
    var f = document.createElement("form");
    f.className = "ficha mini";
    f.noValidate = true;
    var n = "qz" + ++seq + "-";
    var c = estado.contato || {};
    f.innerHTML =
      '<p class="ficha-sub">Informe seu nome e telefone para o corretor Antônio Quinto saber com quem está falando:</p>' +
      campoTexto(n, "nome", "Nome", "text", c.nome || "", 'autocomplete="name" maxlength="60"', true) +
      campoTexto(n, "telefone", "Telefone / WhatsApp", "tel", c.telefone || "", 'autocomplete="tel-national" inputmode="tel" placeholder="(21) 99999-9999" maxlength="16"', true) +
      '<p class="erro-geral" role="alert"></p>' +
      '<button type="submit" class="zap">' + icone("whatsapp") + "<span>Enviar mensagem pelo WhatsApp</span></button>" +
      '<p class="ajuda">O WhatsApp abre com a mensagem pronta. É só tocar em enviar.</p>';
    ligarMascara(f);
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var dados = { nome: valor(f, "nome"), telefone: valor(f, "telefone") };
      var erros = {};
      if (dados.nome.length < 2) erros.nome = "Informe seu nome.";
      if (digitos(dados.telefone).length < 10) erros.telefone = "Informe o telefone com DDD.";
      if (mostrarErros(f, erros)) return;
      estado.contato = Object.assign({}, estado.contato || {}, dados);
      salvar();
      abrirWhatsApp(texto, dados);
      if (depois) depois(f);
      else f.remove();
    });
    return f;
  }

  // Celular e tablet: wa.me abre o aplicativo. Computador: abre direto o WhatsApp Web.
  function ehComputador() {
    var ua = navigator.userAgent || "";
    if (/Android|iPhone|iPad|iPod|Mobile|Windows Phone|IEMobile|Opera Mini/i.test(ua)) return false;
    if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return false; // iPad que se apresenta como Mac
    return true;
  }
  function linkWhatsApp(msg) {
    var t = encodeURIComponent(msg);
    return ehComputador()
      ? "https://web.whatsapp.com/send?phone=" + cfg.whatsapp + "&text=" + t
      : "https://wa.me/" + cfg.whatsapp + "?text=" + t;
  }

  function abrirWhatsApp(texto, contato) {
    var primeiro = String(contato.nome || "").split(" ")[0];
    var base = texto || "Olá, Antônio! Vim pelo site e gostaria de atendimento.";
    var msg = primeiro ? base.replace(/^(Olá, Antônio!)/, "$1 Aqui é " + primeiro + ".") : base;
    if (msg === base && primeiro) msg = "Aqui é " + primeiro + ". " + base;
    // window.open precisa acontecer no próprio clique (senão o navegador bloqueia)
    window.open(linkWhatsApp(msg), "_blank");
    var registrado = registrarWhatsLead(contato.nome, contato.telefone);
    medir("whatsapp", { quinto_chat_lead: registrado ? "sim" : "nao" });
  }

  // Envia o formulário nativo WhatsApp Lead em segundo plano: o ImobiBrasil grava nome e telefone no CRM.
  function registrarWhatsLead(nome, telefone) {
    var f = document.getElementById("frmAPPWhats");
    if (!f) return false;
    try {
      var pares = [];
      var campos = f.querySelectorAll("input[name]");
      for (var i = 0; i < campos.length; i++) {
        var c = campos[i];
        if (c.type === "image" || c.type === "submit") continue;
        var v = c.value;
        if (c.name === "nome") v = nome;
        if (c.name === "telefone") v = mascaraTelefone(telefone);
        pares.push(codificar(c.name) + "=" + codificar(v));
      }
      fetch(f.getAttribute("action") || "/contato/?acao=whats", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: pares.join("&"),
        credentials: "same-origin",
        keepalive: true,
        redirect: "manual",
      }).catch(function () {});
      return true;
    } catch (e) {
      return false;
    }
  }

  // O site do ImobiBrasil é ISO-8859-1: codifica como o próprio navegador codificaria o formulário.
  function codificar(s) {
    s = String(s == null ? "" : s);
    var latin = /iso-8859-1|windows-1252|latin/i.test(document.characterSet || "");
    if (!latin) return encodeURIComponent(s).replace(/%20/g, "+");
    var out = "";
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      var cod = s.charCodeAt(i);
      if (/[A-Za-z0-9*\-._]/.test(ch)) out += ch;
      else if (ch === " ") out += "+";
      else if (cod < 256) out += "%" + (cod < 16 ? "0" : "") + cod.toString(16).toUpperCase();
      else out += encodeURIComponent("&#" + cod + ";");
    }
    return out;
  }

  // ======================================================================
  // Fichas (busca, venda, interesse num imóvel)
  // ======================================================================
  var TIPOS = ["Apartamento", "Casa", "Casa em condomínio", "Cobertura", "Sala comercial", "Outro"];
  // Mesmas chaves do Worker (fichas.js). Para mudar as faixas, mude nos dois lugares.
  var FAIXAS = [
    ["ate300", "Até R$ 300 mil", 300000],
    ["300a500", "R$ 300 mil a R$ 500 mil", 500000],
    ["500a800", "R$ 500 mil a R$ 800 mil", 800000],
    ["800a1200", "R$ 800 mil a R$ 1,2 milhão", 1200000],
    ["1200a2000", "R$ 1,2 milhão a R$ 2 milhões", 2000000],
    ["acima2000", "Acima de R$ 2 milhões", Infinity],
    ["nao_sei", "Ainda não sei / simular financiamento", null],
  ];
  function faixaDe(v) {
    var n = typeof v === "number" ? v : valorEmReais(v);
    if (!n) return "";
    for (var i = 0; i < FAIXAS.length; i++) if (FAIXAS[i][2] !== null && n <= FAIXAS[i][2]) return FAIXAS[i][0];
    return "";
  }
  function rotuloFaixa(chave) {
    for (var i = 0; i < FAIXAS.length; i++) if (FAIXAS[i][0] === chave) return FAIXAS[i][1];
    return "";
  }
  var seq = 0;

  var FICHAS = {
    ficha_busca: {
      titulo: "Busca personalizada",
      sub: "O corretor Antônio Quinto procura esse imóvel no mercado, inclusive entre os que ainda não estão anunciados, e retorna para você.",
      legenda: "O imóvel que você procura",
      campos: [
        ["tipo", "Tipo", "lista", TIPOS, "Qualquer tipo"],
        ["bairros", "Bairros", "texto", 'placeholder="Ex.: Icaraí, Santa Rosa" maxlength="200"'],
        ["quartos_min", "Quartos", "lista", [["1", "1 ou mais"], ["2", "2 ou mais"], ["3", "3 ou mais"], ["4", "4 ou mais"]], "Indiferente", "meia"],
        ["vagas_min", "Vagas", "lista", [["1", "1 ou mais"], ["2", "2 ou mais"], ["3", "3 ou mais"]], "Indiferente", "meia"],
        ["faixa", "Quanto você pretende investir?", "faixa"],
        ["area_min", "Área mínima (m²)", "texto", 'inputmode="numeric" placeholder="Opcional"'],
        ["suite", "Com suíte", "marca"],
        ["pagamento", "Pagamento", "lista", ["À vista", "Financiamento", "Permuta", "Ainda não sei"], "Não informado", "meia"],
        ["prazo", "Prazo para comprar", "lista", ["Até 3 meses", "De 3 a 6 meses", "Mais de 6 meses", "Só pesquisando"], "Não definido", "meia"],
        ["permuta", "Tem imóvel para dar na permuta? Qual?", "texto", 'placeholder="Ex.: apartamento de 2 quartos no Ingá" maxlength="300"'],
        ["caracteristicas", "O que mais é importante?", "area", 'placeholder="Ex.: varanda, andar alto, aceita pet, perto da praia" maxlength="400"'],
      ],
    },
    ficha_venda: {
      titulo: "Venda seu imóvel",
      sub: "Conte um pouco sobre o imóvel e o corretor Antônio Quinto entra em contato para conversar sobre a avaliação e a venda.",
      legenda: "O seu imóvel",
      campos: [
        ["tipo", "Tipo", "lista", TIPOS, "Selecione"],
        ["bairro", "Bairro", "texto", 'maxlength="80"', null, "meia"],
        ["area", "Área útil (m²)", "texto", 'inputmode="numeric"', null, "meia"],
        ["endereco", "Endereço (rua e número)", "texto", 'placeholder="Usado só para a avaliação" maxlength="150"'],
        ["quartos", "Quartos", "lista", [["1", "1"], ["2", "2"], ["3", "3"], ["4", "4 ou mais"]], "Selecione", "meia"],
        ["vagas", "Vagas", "lista", [["0", "Nenhuma"], ["1", "1"], ["2", "2"], ["3", "3 ou mais"]], "Selecione", "meia"],
        ["valor_pretendido", "Valor pretendido (R$)", "texto", 'inputmode="numeric" placeholder="Se não sabe, deixe em branco"'],
        ["situacao", "Situação", "lista", ["Desocupado", "Ocupado pelo proprietário", "Alugado"], "Selecione", "meia"],
        ["aceita_permuta", "Aceita permuta?", "lista", ["Não", "Sim", "Talvez"], "Selecione", "meia"],
        ["documentacao", "Documentação", "lista", ["Escritura registrada no RGI", "Inventário em andamento", "Ainda financiado", "Não sei informar"], "Selecione"],
        ["prazo", "Prazo para vender", "lista", ["Até 3 meses", "De 3 a 6 meses", "Mais de 6 meses"], "Não definido"],
        ["observacoes", "Observações", "area", 'placeholder="Ex.: andar, vista, reformas, por qual imóvel aceitaria permuta" maxlength="400"'],
      ],
    },
    contato_geral: {
      titulo: "Falar com o corretor",
      sub: "Sua mensagem vai para o corretor Antônio Quinto, que entra em contato com você.",
      legenda: "Sua mensagem",
      campos: [["mensagem", "Mensagem", "area", 'maxlength="790" rows="4"']],
    },
    contato_imovel: {
      titulo: "Falar sobre este imóvel",
      sub: "O pedido vai para o corretor Antônio Quinto pelo formulário da página do imóvel.",
      legenda: "Sua mensagem",
      campos: [["mensagem", "Mensagem", "area", 'maxlength="790" rows="4"']],
    },
  };

  function montarFicha(msg) {
    var a = msg.acao;
    var def = FICHAS[a.tipo];
    var p = a.tipo === "contato_imovel" || a.tipo === "contato_geral" ? { mensagem: a.mensagem } : a.dados || {};
    var c = estado.contato || {};
    var n = "qf" + ++seq + "-";
    var f = document.createElement("form");
    f.className = "ficha";
    f.noValidate = true;

    var titulo = def.titulo + (a.tipo === "contato_imovel" && a.codigo ? " #" + esc(a.codigo) : "");
    f.innerHTML =
      '<p class="ficha-titulo">' + icone(a.tipo === "ficha_venda" ? "casa" : "lupa") + titulo + "</p>" +
      '<p class="ficha-sub">' + esc(def.sub) + "</p>" +
      '<fieldset><legend>Seu contato</legend>' +
      campoTexto(n, "nome", "Nome", "text", c.nome || "", 'autocomplete="name" maxlength="80"', true) +
      campoTexto(n, "telefone", "Telefone / WhatsApp", "tel", c.telefone || "", 'autocomplete="tel-national" inputmode="tel" placeholder="(21) 99999-9999" maxlength="16"', true) +
      campoTexto(n, "email", "E-mail", "email", c.email || "", 'autocomplete="email" maxlength="80"', true) +
      "</fieldset>" +
      "<fieldset><legend>" + esc(def.legenda) + "</legend>" + camposDaFicha(n, def.campos, p) + "</fieldset>" +
      '<p class="erro-geral" role="alert"></p>' +
      '<button type="submit" class="enviar-ficha">Enviar para o corretor</button>' +
      '<button type="button" class="zap secundario">' + icone("whatsapp") + "<span>Prefiro falar no WhatsApp</span></button>";
    ligarMascara(f);

    var selFaixa = f.querySelector('[name="faixa"]');
    if (selFaixa) {
      var calc = f.querySelector(".calc");
      calc.href = a.calculadora || cfg.calculadora;
      var mostrarCalc = function () {
        calc.hidden = selFaixa.value !== "nao_sei";
      };
      selFaixa.addEventListener("change", mostrarCalc);
      mostrarCalc();
      calc.addEventListener("click", function () {
        medir("calculadora");
      });
    }

    f.querySelector(".zap").addEventListener("click", function () {
      var dados = coletar(f, def);
      var texto = "Olá, Antônio! Vim pelo assistente do site.\n" + compor(a, dados);
      if (dados.nome.length >= 2 && digitos(dados.telefone).length >= 10) {
        estado.contato = { nome: dados.nome, telefone: dados.telefone, email: dados.email };
        salvar();
        abrirWhatsApp(texto, dados);
      } else if (!f.querySelector(".mini")) {
        f.appendChild(miniZap(texto));
      }
    });

    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var dados = coletar(f, def);
      var erros = {};
      if (dados.nome.length < 2) erros.nome = "Informe seu nome.";
      if (digitos(dados.telefone).length < 10 || digitos(dados.telefone).length > 11) erros.telefone = "Informe o telefone com DDD.";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(dados.email)) erros.email = "Informe um e-mail válido.";
      if ((a.tipo === "contato_imovel" || a.tipo === "contato_geral") && !dados.mensagem) erros.mensagem = "Escreva sua mensagem.";
      if (a.tipo === "ficha_busca" && !dados.faixa) erros.faixa = "Escolha quanto pretende investir.";
      if (mostrarErros(f, erros)) return;

      estado.contato = { nome: dados.nome, telefone: dados.telefone, email: dados.email };
      a.feito = true;
      var entrega = {
        destino: a.tipo === "contato_imovel" ? "imovel" : "contato",
        tipo: a.tipo,
        id: a.id || "",
        url: a.tipo === "contato_imovel" ? a.url : "/contato",
        campos: { nome: dados.nome, email: dados.email, telefone: dados.telefone, mensagem: compor(a, dados) },
        calc: a.tipo === "ficha_busca" && dados.faixa === "nao_sei" ? a.calculadora || cfg.calculadora : "",
        criado: Date.now(),
      };
      estado.historico.push({
        role: "assistant",
        content: "[O visitante preencheu a ficha (" + a.tipo + ") e foi levado ao formulário do site para enviar ao Antônio.]",
      });
      medir("ficha_preenchida", { quinto_chat_tipo: a.tipo });
      f.remove();
      adicionar({
        de: "bot",
        texto:
          "Perfeito, " + dados.nome.split(" ")[0] + "! Estou abrindo o formulário do corretor já preenchido. **Falta só digitar o código de 4 números e tocar em Enviar.**" +
          (entrega.calc ? "\nSe quiser, simule seu financiamento enquanto isso: " + entrega.calc : ""),
      });
      gravar(CHAVE_ENTREGA, entrega);
      if (!aplicarEntrega()) {
        location.href = entrega.url;
      }
    });
    return f;
  }

  function camposDaFicha(n, campos, p) {
    var html = "";
    var meia = [];
    function despejar() {
      if (meia.length) html += '<div class="duas">' + meia.join("") + "</div>";
      meia = [];
    }
    campos.forEach(function (c) {
      var nome = c[0], rotulo = c[1], tipo = c[2], extra = c[3], vazio = c[4], largura = c[5];
      var v = p[nome];
      var h;
      if (tipo === "faixa") h = campoFaixa(n, nome, rotulo, p.faixa || faixaDe(p.preco_max));
      else if (tipo === "lista") h = campoLista(n, nome, rotulo, extra, v, vazio);
      else if (tipo === "marca") h = '<div class="campo marcar"><label><input type="checkbox" name="' + nome + '"' + (v ? " checked" : "") + "><span>" + esc(rotulo) + "</span></label></div>";
      else if (tipo === "area") h = '<div class="campo"><label for="' + n + nome + '">' + esc(rotulo) + '</label><textarea id="' + n + nome + '" name="' + nome + '" ' + (extra || 'rows="2"') + ">" + esc(v || "") + "</textarea>" + erroDe(n, nome) + "</div>";
      else {
        var mostrado = v == null ? "" : /preco|valor/.test(nome) && typeof v === "number" ? Math.round(v).toLocaleString("pt-BR") : v;
        h = campoTexto(n, nome, rotulo, "text", mostrado, extra);
      }
      if (largura === "meia") {
        meia.push(h);
        if (meia.length === 2) despejar();
      } else {
        despejar();
        html += h;
      }
    });
    despejar();
    return html;
  }

  function campoTexto(n, nome, rotulo, tipo, v, extra, obrig) {
    return (
      '<div class="campo"><label for="' + n + nome + '">' + esc(rotulo) + (obrig ? ' <b aria-hidden="true">*</b>' : "") + "</label>" +
      '<input id="' + n + nome + '" name="' + nome + '" type="' + tipo + '" value="' + esc(v == null ? "" : v) + '" aria-describedby="' + n + nome + '-erro" ' + (extra || "") + (obrig ? " required" : "") + ">" +
      erroDe(n, nome) + "</div>"
    );
  }

  function campoLista(n, nome, rotulo, opcoes, v, vazio) {
    var h = '<div class="campo"><label for="' + n + nome + '">' + esc(rotulo) + '</label><select id="' + n + nome + '" name="' + nome + '"><option value="">' + esc(vazio || "Indiferente") + "</option>";
    opcoes.forEach(function (o) {
      var val = typeof o === "object" ? o[0] : o;
      var txt = typeof o === "object" ? o[1] : o;
      h += '<option value="' + esc(val) + '"' + (v != null && v !== "" && String(v) === String(val) ? " selected" : "") + ">" + esc(txt) + "</option>";
    });
    return h + "</select></div>";
  }

  // Faixa de valor: obrigatória; quem escolhe "Ainda não sei" vê o link da calculadora
  function campoFaixa(n, nome, rotulo, v) {
    var h =
      '<div class="campo"><label for="' + n + nome + '">' + esc(rotulo) + ' <b aria-hidden="true">*</b></label>' +
      '<select id="' + n + nome + '" name="' + nome + '" required aria-describedby="' + n + nome + '-ajuda ' + n + nome + '-erro"><option value="">Selecione uma faixa</option>';
    FAIXAS.forEach(function (fx) {
      h += '<option value="' + fx[0] + '"' + (v === fx[0] ? " selected" : "") + ">" + esc(fx[1]) + "</option>";
    });
    return (
      h + "</select>" +
      '<small class="ajuda" id="' + n + nome + '-ajuda">Você define o valor. Ajuste se quiser.</small>' +
      '<a class="calc" href="#" target="_blank" rel="noopener" hidden>Simule seu financiamento ›</a>' +
      erroDe(n, nome) + "</div>"
    );
  }

  function erroDe(n, nome) {
    return '<small class="erro" data-erro="' + nome + '" id="' + n + nome + '-erro"></small>';
  }

  function coletar(f, def) {
    var d = { nome: valor(f, "nome"), telefone: valor(f, "telefone"), email: valor(f, "email").toLowerCase() };
    def.campos.forEach(function (c) {
      if (c[2] === "marca") {
        var cb = f.querySelector('[name="' + c[0] + '"]');
        d[c[0]] = !!(cb && cb.checked);
      } else d[c[0]] = valor(f, c[0]);
    });
    return d;
  }

  function valor(f, nome) {
    var el = f.querySelector('[name="' + nome + '"]');
    return el ? String(el.value || "").trim() : "";
  }

  // Monta o texto que vai no campo "mensagem" do formulário nativo
  function compor(a, d) {
    if (a.tipo === "contato_imovel" || a.tipo === "contato_geral") return d.mensagem;
    var L = [];
    if (a.tipo === "ficha_busca") {
      var p = [d.tipo || "Imóvel"];
      if (d.quartos_min) p.push(d.quartos_min + "+ quartos");
      if (d.suite) p.push("com suíte");
      if (d.vagas_min) p.push(d.vagas_min + "+ vagas");
      if (d.area_min) p.push("a partir de " + d.area_min + " m²");
      if (d.bairros) p.push("em " + d.bairros);
      L.push("BUSCA PERSONALIZADA (pelo assistente do site)");
      L.push("Procuro: " + p.join(", "));
      if (d.faixa) L.push("Quanto pretendo investir: " + (d.faixa === "nao_sei" ? "ainda não sei / quero simular financiamento" : rotuloFaixa(d.faixa)));
      if (d.pagamento) L.push("Pagamento: " + d.pagamento);
      if (d.permuta) L.push("Imóvel para permuta: " + d.permuta);
      if (d.prazo) L.push("Prazo: " + d.prazo);
      if (d.caracteristicas) L.push("Também quero: " + d.caracteristicas);
    } else {
      var im = [d.tipo || "Imóvel"];
      if (d.quartos) im.push(d.quartos === "4" ? "4 ou mais quartos" : d.quartos + (d.quartos === "1" ? " quarto" : " quartos"));
      if (d.vagas !== "") im.push(d.vagas === "0" ? "sem vaga" : d.vagas === "3" ? "3 ou mais vagas" : d.vagas + (d.vagas === "1" ? " vaga" : " vagas"));
      if (d.area) im.push(d.area + " m²");
      if (d.bairro) im.push("em " + d.bairro);
      L.push("QUERO VENDER MEU IMÓVEL (pelo assistente do site)");
      L.push("Imóvel: " + im.join(", "));
      if (d.endereco) L.push("Endereço: " + d.endereco);
      var vp = valorEmReais(d.valor_pretendido);
      L.push("Valor pretendido: " + (vp ? reais(vp) : d.valor_pretendido || "quero uma avaliação"));
      if (d.situacao) L.push("Situação: " + d.situacao);
      if (d.documentacao) L.push("Documentação: " + d.documentacao);
      if (d.aceita_permuta) L.push("Aceita permuta: " + d.aceita_permuta);
      if (d.prazo) L.push("Prazo para vender: " + d.prazo);
      if (d.observacoes) L.push("Observações: " + d.observacoes);
    }
    return L.join("\n");
  }

  // ======================================================================
  // Entrega: preenche o formulário nativo do ImobiBrasil nesta página
  // ======================================================================
  var MAPA_IMOVEL = { nome: "nome", email: "email", telefone: "telefone1", mensagem: "mensagem" };
  var MAPA_CONTATO = { nome: "nome", email: "endemail", telefone: "telefone", mensagem: "mensagem" };

  // null = não é esta página; "esperar" = é esta página mas o formulário ainda não carregou
  function alvoDaEntrega(e) {
    if (e.destino === "contato") {
      if (!/^\/contato\/?$/.test(location.pathname)) return null;
      var fc = document.getElementById("frmContato");
      return fc ? { form: fc, map: MAPA_CONTATO } : "esperar";
    }
    if (e.destino === "imovel") {
      if (!e.id || location.pathname.indexOf("/imovel/" + e.id + "/") === -1) return null;
      var candidatos = [document.forms.frmcon1, document.forms.frmemi].filter(Boolean);
      if (!candidatos.length) return "esperar";
      for (var i = 0; i < candidatos.length; i++) {
        if (candidatos[i].getBoundingClientRect().height > 0) return { form: candidatos[i], map: MAPA_IMOVEL };
      }
      return { form: candidatos[0], map: MAPA_IMOVEL };
    }
    return null;
  }

  // true se a entrega pertence a esta página (e já está sendo cuidada); false se é preciso navegar
  function aplicarEntrega() {
    var e = ler(CHAVE_ENTREGA);
    if (!e) return false;
    if (Date.now() - (e.criado || 0) > VALIDADE_ENTREGA) {
      gravar(CHAVE_ENTREGA, null);
      return false;
    }
    if (alvoDaEntrega(e) === null) return false;
    var tentativas = 0;
    (function tentar() {
      var a = alvoDaEntrega(e);
      if (a && a !== "esperar") preencher(e, a);
      else if (++tentativas < 30) setTimeout(tentar, 300);
      else falhaEntrega(e);
    })();
    return true;
  }

  function preencher(e, alvo) {
    gravar(CHAVE_ENTREGA, null);
    var f = alvo.form;
    for (var k in alvo.map) {
      var el = f.elements[alvo.map[k]];
      if (!el) {
        falhaEntrega(e);
        return;
      }
      var v = k === "telefone" ? mascaraTelefone(e.campos.telefone) : e.campos[k];
      if (k === "mensagem" && el.maxLength > 0 && v.length > el.maxLength) v = v.slice(0, el.maxLength - 3) + "...";
      el.value = v;
      disparar(el, "input");
      disparar(el, "change");
    }
    fechar();
    var codigo = f.elements.chave;
    try {
      f.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (x) {
      f.scrollIntoView();
    }
    if (codigo) {
      codigo.style.outline = "3px solid #f2b84b";
      codigo.style.outlineOffset = "2px";
      setTimeout(function () {
        try {
          codigo.focus({ preventScroll: true });
        } catch (x) {
          codigo.focus();
        }
      }, 700);
    }
    guia.hidden = false;
    medir("formulario_preenchido", { quinto_chat_tipo: e.tipo });

    // O próprio formulário valida dados e código; se não barrou o envio, contamos como lead
    f.addEventListener("submit", function (ev) {
      if (ev.defaultPrevented) return;
      guia.hidden = true;
      if (codigo) codigo.style.outline = "";
      medir("lead_enviado", { quinto_chat_tipo: e.tipo, quinto_chat_origem: e.destino === "imovel" ? "informacoes_imovel" : "fale_conosco" });
      estado.historico.push({ role: "assistant", content: "[O formulário foi enviado ao Antônio.]" });
      adicionar({
        de: "bot",
        texto:
          "Recebido! Sua mensagem foi enviada ao corretor Antônio Quinto, e ele vai falar com você em breve. Se tiver pressa, pode chamar no WhatsApp também." +
          (e.calc ? "\nEnquanto isso, simule seu financiamento: " + e.calc : ""),
        acao: { tipo: "whatsapp", texto: "Olá, Antônio! Acabei de enviar uma mensagem pelo site." },
        zapRotulo: "Chamar o corretor no WhatsApp",
        zapSecundario: true,
      });
    });
  }

  function falhaEntrega(e) {
    gravar(CHAVE_ENTREGA, null);
    medir("formulario_indisponivel", { quinto_chat_tipo: e.tipo });
    adicionar({
      de: "bot",
      texto: "Não consegui abrir o formulário do site agora. Toque no botão abaixo para mandar sua mensagem pelo WhatsApp, com tudo o que você preencheu.",
      acao: { tipo: "whatsapp", texto: "Olá, Antônio! Vim pelo assistente do site.\n" + e.campos.mensagem },
      zapRotulo: "Enviar pelo WhatsApp",
    });
    abrir();
  }

  function disparar(el, tipo) {
    try {
      el.dispatchEvent(new Event(tipo, { bubbles: true }));
    } catch (x) {}
  }

  // ---------- validação e máscaras ----------
  function mostrarErros(f, erros) {
    var tem = false;
    var todos = f.querySelectorAll("[data-erro]");
    for (var i = 0; i < todos.length; i++) todos[i].textContent = "";
    var marcados = f.querySelectorAll("[aria-invalid]");
    for (var j = 0; j < marcados.length; j++) marcados[j].removeAttribute("aria-invalid");
    var primeiro = null;
    for (var nome in erros) {
      tem = true;
      var alvo = f.querySelector('[data-erro="' + nome + '"]');
      if (alvo) alvo.textContent = erros[nome];
      var c = f.querySelector('[name="' + nome + '"]');
      if (c) {
        c.setAttribute("aria-invalid", "true");
        if (!primeiro) primeiro = c;
      }
    }
    var geral = f.querySelector(".erro-geral");
    if (geral) geral.textContent = tem ? "Confira os campos destacados." : "";
    if (primeiro) primeiro.focus();
    return tem;
  }

  function ligarMascara(f) {
    var tel = f.querySelector('[name="telefone"]');
    if (tel)
      tel.addEventListener("input", function () {
        tel.value = mascaraTelefone(tel.value);
      });
  }

  function digitos(v) {
    var d = String(v || "").replace(/\D/g, "");
    if (d.length >= 12 && d.indexOf("55") === 0) d = d.slice(2);
    if (d.charAt(0) === "0") d = d.replace(/^0+/, "");
    return d;
  }

  // Mesmo formato da máscara do próprio site: (DD) NNNNN-NNNN
  function mascaraTelefone(v) {
    var d = digitos(v).slice(0, 11);
    if (d.length <= 2) return d ? "(" + d : "";
    return "(" + d.slice(0, 2) + ") " + d.slice(2, 7) + (d.length > 7 ? "-" + d.slice(7) : "");
  }

  function valorEmReais(v) {
    var s = String(v || "").toLowerCase().replace(/r\$\s*/g, "").trim();
    if (!s) return null;
    var m = s.match(/(\d+(?:[.,]\d+)*)\s*(mil|k|milh[aã]o|milh[oõ]es|mi|m)?\b/);
    if (!m) return null;
    var n = m[1];
    var mult = !m[2] ? 1 : /^(mil|k)$/.test(m[2]) ? 1e3 : 1e6;
    if (mult === 1) n = n.replace(/[.,](\d{2})$/, "x$1").replace(/[.,]/g, "").replace("x", ".");
    else n = n.replace(/\./g, "").replace(",", ".");
    var r = Math.round(parseFloat(n) * mult);
    return r > 0 && r < 1e9 ? r : null;
  }

  // ---------- utilidades ----------
  function formatar(texto) {
    var h = esc(texto || "");
    h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    // "R$ 359.000", "R$ 1,2 milhão" e telefones não quebram no meio
    h = h.replace(/R\$\s?\d+(?:[.,]\d+)*(?:\s(?:mil|milh[ãa]o|milh[õo]es))?/g, '<span class="nw">$&</span>');
    h = h.replace(/\(?\b\d{2}\)?\s?9?\d{4}-\d{4}\b/g, '<span class="nw">$&</span>');
    h = h.replace(/(https:\/\/[a-z0-9.-]+\.[a-z]{2,}[^\s<)]*)/gi, function (u) {
      var limpo = u.replace(/[.,;:!?]+$/, "");
      return '<a href="' + limpo + '" target="_blank" rel="noopener">' + limpo + "</a>" + u.slice(limpo.length);
    });
    return h.replace(/\n/g, "<br>");
  }
  function esc(t) {
    return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function reais(v) {
    try {
      return "R$ " + Math.round(v).toLocaleString("pt-BR");
    } catch (e) {
      return "R$ " + Math.round(v);
    }
  }
  function rolar() {
    lista.scrollTop = lista.scrollHeight;
  }
  function ajustarAltura() {
    campo.style.height = "auto";
    campo.style.height = Math.min(campo.scrollHeight, 110) + "px";
  }

  function icone(nome) {
    var p = {
      chat: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.6c-.5.4-1.3.1-1.3-.6V16A2.5 2.5 0 0 1 4 13.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="8.5" cy="9.5" r="1.1" fill="currentColor"/><circle cx="12" cy="9.5" r="1.1" fill="currentColor"/><circle cx="15.5" cy="9.5" r="1.1" fill="currentColor"/>',
      x: '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
      lupa: '<circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
      enviar: '<path d="M4 12l15-7-5 15-2.5-6.5z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/>',
      mic: '<rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
      casa: '<path d="M4 11l8-6 8 6v8a1 1 0 0 1-1 1h-4v-5H9v5H5a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
      whatsapp: '<path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9 8.3c.2-.4.4-.4.7-.4h.5c.2 0 .4 0 .5.4l.7 1.6c.1.2 0 .4-.1.6l-.5.6c-.1.1-.2.3 0 .5.5.9 1.3 1.7 2.3 2.2.2.1.4.1.5-.1l.6-.7c.2-.2.4-.2.6-.1l1.5.7c.2.1.4.2.4.4 0 .5-.1 1.1-.6 1.5-.5.4-1.4.7-2.4.4-1.3-.4-2.9-1.4-4-2.8-.9-1.1-1.4-2.3-1.4-3.1 0-.7.3-1.3.7-1.7z" fill="currentColor"/>',
    }[nome];
    return '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">' + p + "</svg>";
  }

  // cores derivadas da cor principal (para o efeito 3D do botão)
  function rgbDe(hex) {
    var h = String(hex).replace("#", "");
    if (h.length === 3) h = h.replace(/(.)/g, "$1$1");
    var n = parseInt(h, 16);
    if (isNaN(n) || h.length !== 6) return [228, 9, 81];
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  // f > 0 clareia (mistura com branco), f < 0 escurece (mistura com preto)
  function tom(hex, f) {
    return "rgb(" + rgbDe(hex).map(function (v) {
      return Math.round(f > 0 ? v + (255 - v) * f : v * (1 + f));
    }).join(",") + ")";
  }
  function rgba(hex, a) {
    return "rgba(" + rgbDe(hex).join(",") + "," + a + ")";
  }

  function css() {
    var c = cfg.cor;
    return (
      ":host{all:initial}" +
      "*{box-sizing:border-box;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif}" +
      // botão em 3D: brilho no alto, borda inferior mais escura (efeito de tecla) e sombra na cor da marca
      ".lancador{position:fixed;" + lado + ":20px;bottom:26px;z-index:2147483000;width:64px;height:64px;padding:0;border-radius:50%;border:0;color:#fff;display:grid;place-items:center;cursor:pointer;" +
      "background:radial-gradient(circle at 32% 24%,rgba(255,255,255,.6) 0,rgba(255,255,255,0) 40%),linear-gradient(160deg," + tom(c, 0.28) + " 0%," + c + " 52%," + tom(c, -0.3) + " 100%);" +
      "box-shadow:inset 0 -6px 9px rgba(0,0,0,.25),inset 0 3px 4px rgba(255,255,255,.4),0 5px 0 " + tom(c, -0.45) + ",0 13px 24px " + rgba(c, 0.45) + ";" +
      "transition:transform .15s,box-shadow .15s;animation:pulo 7s ease-in-out 2s infinite}" +
      ".lancador::before,.lancador::after{content:'';position:absolute;inset:0;border-radius:50%;border:3px solid " + c + ";pointer-events:none;animation:anel 2.6s ease-out infinite}" +
      ".lancador::after{animation-delay:1.3s}" +
      ".lancador svg{width:31px;height:31px;filter:drop-shadow(0 2px 1px rgba(0,0,0,.35))}" +
      ".lancador:hover{animation:none;transform:translateY(-3px) scale(1.05)}" +
      ".lancador:active{animation:none;transform:translateY(4px);box-shadow:inset 0 -3px 6px rgba(0,0,0,.25),inset 0 3px 4px rgba(255,255,255,.4),0 1px 0 " + tom(c, -0.45) + ",0 5px 12px " + rgba(c, 0.4) + "}" +
      ".lancador.calmo{animation:none}.lancador.calmo::before,.lancador.calmo::after{display:none}" +
      "@keyframes pulo{0%,80%,100%{transform:translateY(0)}84%{transform:translateY(-12px)}88%{transform:translateY(0)}92%{transform:translateY(-5px)}96%{transform:translateY(0)}}" +
      "@keyframes anel{0%{transform:scale(1);opacity:.75}100%{transform:scale(1.75);opacity:0}}" +
      ".lancador:focus-visible,.painel button:focus-visible,.painel a:focus-visible{outline:3px solid #f2b84b;outline-offset:2px}" +
      ".dica{position:fixed;" + lado + ":100px;bottom:34px;z-index:2147483000;display:flex;gap:10px;align-items:flex-start;background:#fff;color:#1b2733;font-size:14px;line-height:1.4;padding:12px 30px 12px 12px;border-radius:14px;max-width:290px;box-shadow:0 10px 30px rgba(10,25,40,.22);border-" + lado + ":4px solid " + c + ";cursor:pointer;animation:surgir .35s ease-out}" +
      ".dica::after{content:'';position:absolute;bottom:22px;" + lado + ":-10px;border:6px solid transparent;border-" + (lado === "right" ? "left" : "right") + "-color:" + c + "}" +
      ".dica-avatar{flex:none;width:32px;height:32px;border-radius:50%;background:" + c + ";color:#fff;display:grid;place-items:center;font-weight:700;font-size:15px}" +
      ".dica-corpo{display:flex;flex-direction:column;gap:4px}.dica-acao{font-weight:700;font-size:13px;color:" + c + "}" +
      "@keyframes surgir{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:none}}" +
      ".fechar-dica,.fechar-guia{position:absolute;top:4px;right:6px;border:0;background:none;font-size:18px;color:#8a96a3;cursor:pointer}" +
      ".guia{position:fixed;left:50%;transform:translateX(-50%);bottom:16px;z-index:2147483002;width:min(420px,calc(100vw - 32px));background:#fff8e1;border:2px solid #f2b84b;color:#1b2733;border-radius:14px;padding:12px 32px 12px 14px;box-shadow:0 10px 30px rgba(10,25,40,.25);display:flex;flex-direction:column;gap:3px;font-size:14px;line-height:1.4}" +
      ".guia strong{font-size:15px}" +
      ".painel{position:fixed;" + lado + ":20px;bottom:20px;z-index:2147483001;width:380px;height:min(640px,calc(100vh - 40px));background:#f6f7f9;border-radius:16px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 18px 50px rgba(10,25,40,.3);color:#1b2733;font-size:15px}" +
      "[hidden]{display:none!important}" +
      "header{display:flex;align-items:center;gap:10px;padding:14px 12px 14px 16px;background:" + c + ";color:#fff}" +
      ".avatar{width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,.16);display:grid;place-items:center;font-weight:700;font-size:18px}" +
      ".titulos{flex:1;display:flex;flex-direction:column;line-height:1.25}.titulos strong{font-size:16px}.titulos span{font-size:12.5px;opacity:.85}" +
      ".fechar{border:0;background:none;color:#fff;cursor:pointer;padding:6px;border-radius:8px;display:grid}.fechar:hover{background:rgba(255,255,255,.12)}" +
      ".mensagens{position:relative;flex:1;overflow-y:auto;padding:16px 12px 8px;display:flex;flex-direction:column;gap:10px;overscroll-behavior:contain}" +
      ".msg{display:flex;flex-direction:column;gap:8px;max-width:88%}.msg.eu{align-self:flex-end;align-items:flex-end}.msg.bot{align-self:flex-start}" +
      ".msg.largo{max-width:100%;align-self:stretch}" +
      ".balao{padding:10px 13px;border-radius:14px;line-height:1.45;word-wrap:break-word}" +
      ".bot .balao{background:#fff;border:1px solid #e3e7ec;border-bottom-left-radius:4px}" +
      ".eu .balao{background:" + c + ";color:#fff;border-bottom-right-radius:4px}" +
      ".balao a{color:inherit;text-decoration:underline;word-break:break-all}" +
      ".imovel{display:flex;gap:10px;background:#fff;border:1px solid #e3e7ec;border-radius:12px;padding:8px;text-decoration:none;color:inherit;transition:border-color .15s,box-shadow .15s}" +
      ".imovel:hover{border-color:" + c + ";box-shadow:0 3px 12px rgba(10,25,40,.08)}" +
      ".imovel img,.sem-foto{width:84px;height:84px;border-radius:8px;object-fit:cover;flex:none;background:#e8ecf0}" +
      ".sem-foto{display:grid;place-items:center;color:#8a96a3}" +
      ".info{display:flex;flex-direction:column;gap:2px;min-width:0}" +
      ".codigo{font-size:11.5px;color:#6b7785;letter-spacing:.02em}" +
      ".titulo{font-size:13.5px;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}" +
      ".detalhes{font-size:12.5px;color:#4d5966}.preco{font-weight:700;font-size:15px;color:" + c + ";margin-top:auto}" +
      ".zap-caixa{display:flex;flex-direction:column;gap:8px}" +
      ".zap{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;border:0;cursor:pointer;background:#1f9d55;color:#fff;text-decoration:none;font-weight:600;font-size:14.5px;padding:11px 14px;border-radius:12px}" +
      ".zap:hover{background:#178547}" +
      ".zap.secundario{background:#fff;color:#178547;border:1.5px solid #1f9d55}.zap.secundario:hover{background:#eefaf3}" +
      ".digitando{display:flex;gap:4px;padding:14px}.digitando i{width:7px;height:7px;border-radius:50%;background:#9aa5b1;animation:pula 1.2s infinite}" +
      ".digitando i:nth-child(2){animation-delay:.15s}.digitando i:nth-child(3){animation-delay:.3s}" +
      "@keyframes pula{0%,60%,100%{transform:none;opacity:.5}30%{transform:translateY(-4px);opacity:1}}" +
      ".sugestoes{display:flex;flex-wrap:wrap;gap:6px;padding:0 12px 8px}.sugestoes:empty{display:none}" +
      ".sugestoes button{border:1px solid " + c + ";background:#fff;color:" + c + ";border-radius:999px;padding:7px 12px;font-size:13.5px;cursor:pointer}" +
      ".sugestoes button:hover{background:" + c + ";color:#fff}" +
      ".entrada{display:flex;align-items:flex-end;gap:8px;padding:10px 12px;background:#fff;border-top:1px solid #e3e7ec}" +
      ".entrada textarea{flex:1;resize:none;border:1px solid #d5dbe1;border-radius:12px;padding:10px 12px;font-size:15px;line-height:1.35;max-height:110px;outline:none;color:#1b2733;background:#fff}" +
      ".entrada textarea:focus{border-color:" + c + "}" +
      ".entrada button{width:42px;height:42px;flex:none;border:0;border-radius:50%;background:" + c + ";color:#fff;display:grid;place-items:center;cursor:pointer}" +
      ".entrada button:disabled{opacity:.5;cursor:default}" +
      ".entrada .mic{background:#fff;color:" + c + ";border:1.5px solid " + c + "}" +
      ".entrada .mic.gravando{background:" + c + ";color:#fff;animation:gravar 1.2s ease-in-out infinite}" +
      "@keyframes gravar{0%,100%{box-shadow:0 0 0 0 " + rgba(c, 0.45) + "}50%{box-shadow:0 0 0 8px " + rgba(c, 0) + "}}" +
      ".nw{white-space:nowrap}" +
      ".ajuda{margin:0;font-size:12px;line-height:1.35;color:#6b7785}" +
      ".mini .ajuda{text-align:center}" +
      ".calc{font-size:13px;font-weight:600;color:" + c + ";text-decoration:underline;margin-top:2px}" +
      ".aviso{margin:0;padding:6px 14px 10px;background:#fff;font-size:11.5px;line-height:1.35;color:#6b7785}" +
      ".ficha{background:#fff;border:1px solid #d5dbe1;border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:10px}" +
      ".ficha.mini{padding:12px;border-color:#bfe5cf;background:#f7fcf9}" +
      ".ficha-titulo{margin:0;display:flex;align-items:center;gap:6px;font-weight:700;font-size:15.5px;color:" + c + "}.ficha-titulo svg{width:19px;height:19px}" +
      ".ficha-sub{margin:-4px 0 0;font-size:13px;line-height:1.4;color:#4d5966}.mini .ficha-sub{margin:0}" +
      ".ficha fieldset{border:0;margin:0;padding:0;display:flex;flex-direction:column;gap:8px;min-width:0}" +
      ".ficha legend{padding:0;margin-bottom:6px;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#6b7785}" +
      ".campo{display:flex;flex-direction:column;gap:3px;min-width:0}.campo label{font-size:12.5px;color:#4d5966}.campo label b{color:#b42318;font-weight:600}" +
      ".ficha input[type=text],.ficha input[type=tel],.ficha input[type=email],.ficha select,.ficha textarea{width:100%;border:1px solid #d5dbe1;border-radius:9px;padding:8px 10px;font-size:14px;color:#1b2733;background:#fff;outline:none}" +
      ".ficha textarea{resize:vertical;line-height:1.35}" +
      ".ficha input:focus,.ficha select:focus,.ficha textarea:focus{border-color:" + c + ";box-shadow:0 0 0 2px " + rgba(c, 0.15) + "}" +
      ".ficha [aria-invalid=true]{border-color:#b42318!important}" +
      ".duas{display:grid;grid-template-columns:1fr 1fr;gap:8px;align-items:end}" +
      ".marcar label{display:flex;align-items:center;gap:7px;font-size:13.5px;color:#1b2733;cursor:pointer}.marcar input{margin:0;width:16px;height:16px;flex:none;accent-color:" + c + "}" +
      ".erro{color:#b42318;font-size:12px}.erro:empty{display:none}.erro-geral{margin:0;color:#b42318;font-size:12.5px}.erro-geral:empty{display:none}" +
      ".enviar-ficha{border:0;border-radius:12px;background:" + c + ";color:#fff;font-weight:600;font-size:15px;padding:12px;cursor:pointer}" +
      "@media (max-width:480px){.painel{inset:0;width:100%;height:100%;border-radius:0;padding-bottom:env(safe-area-inset-bottom)}.entrada textarea,.ficha input,.ficha select,.ficha textarea{font-size:16px!important}.lancador{bottom:22px;" + lado + ":16px}" +
        ".guia{bottom:100px}" +
        ".dica{" + lado + ":16px;bottom:104px;max-width:min(300px,calc(100vw - 32px));border-" + lado + ":0;border-bottom:4px solid " + c + "}" +
        ".dica::after{bottom:-14px;" + lado + ":26px;border-color:transparent;border-top-color:" + c + "}}" +
      "@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}"
    );
  }

  if (document.body) iniciar();
  else document.addEventListener("DOMContentLoaded", iniciar);
})();
