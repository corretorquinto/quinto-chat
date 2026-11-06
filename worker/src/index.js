// Quinto Chat - backend do agente de atendimento (Cloudflare Worker)
//
// POST /chat   { mensagens: [{ role: "user"|"assistant", content: "..." }], pagina: { url, titulo } }
//           -> { texto, imoveis: [cartões], acao: null | {...} }
//
//   acao.tipo:
//     "ficha_busca"    ficha de busca personalizada (pré-preenchida) -> enviada pelo Fale Conosco
//     "ficha_venda"    ficha de captação (quem quer vender)          -> enviada pelo Fale Conosco
//     "contato_imovel" interesse num imóvel (visita/proposta/info)   -> formulário da página do imóvel
//     "whatsapp"       conversa no WhatsApp                          -> registra no WhatsApp Lead e abre o WhatsApp
//
// GET  /saude  -> verifica se o Worker está no ar e se o catálogo carrega
//
// Os leads NÃO passam por aqui: o widget usa os formulários nativos do ImobiBrasil no
// navegador do visitante, e é o ImobiBrasil que grava no CRM e avisa por e-mail.
// As chaves de API ficam só aqui, como "secrets" do Cloudflare. Nunca no site.
//
// O modelo de IA é trocável: Anthropic, OpenAI, DeepSeek, Gemini ou qualquer API
// compatível com OpenAI. Veja provedores.js e a seção [vars] do wrangler.toml.

import { INSTRUCOES } from "./prompt.js";
import {
  carregarCatalogo,
  buscar,
  acharPorCodigo,
  acharPorUrl,
  detalhes,
  cartao,
  resumoDoCatalogo,
} from "./catalogo.js";
import { prefillBusca, prefillVenda, mensagemImovel, completarFicha } from "./fichas.js";
import { chamarModelo, provedoresConfigurados } from "./provedores.js";

const MAX_MENSAGENS = 16; // histórico enviado ao modelo
const MAX_CARACTERES = 800; // por mensagem do visitante
const MAX_VOLTAS = 4; // chamadas ao modelo por pergunta (busca + resposta)
const MAX_CARTOES = 4;
const LIMITE = { janelaMs: 10 * 60 * 1000, mensagens: 20 }; // por IP, a cada 10 minutos
const LIMITE_DIA = { janelaMs: 24 * 60 * 60 * 1000, mensagens: 40 }; // por IP, por dia
const LIMITE_CONVERSA = 15; // mensagens do visitante por visita; depois disso, só o corretor
const EMPURRAO_EM = [6, 11]; // nessas mensagens, sem contato ainda, o agente oferece o corretor

const visitas = new Map();

const FERRAMENTAS = [
  {
    name: "buscar_imoveis",
    description:
      "Busca imóveis à venda no catálogo da Quinto Imóveis. Todos os filtros são opcionais; use só os que o visitante informou. Retorna o total encontrado e até 'limite' imóveis resumidos.",
    input_schema: {
      type: "object",
      properties: {
        bairro: {
          type: "array",
          items: { type: "string" },
          description: "Um ou mais bairros de Niterói, ex.: ['Icaraí'] ou ['Santa Rosa', 'Ingá']",
        },
        tipo: { type: "string", description: "apartamento, casa, cobertura ou sala comercial" },
        quartos_min: { type: "integer" },
        quartos_max: { type: "integer" },
        suite: { type: "boolean", description: "true se precisa ter ao menos uma suíte" },
        vagas_min: { type: "integer" },
        area_min: { type: "number", description: "Área mínima em m²" },
        preco_min: { type: "number", description: "Em reais, ex.: 500000" },
        preco_max: { type: "number", description: "Em reais, ex.: 800000" },
        palavras_chave: {
          type: "array",
          items: { type: "string" },
          description: "Termos que devem aparecer no anúncio, ex.: ['varanda'], ['vista mar'], ['piscina']",
        },
        limite: { type: "integer", description: "Quantos imóveis retornar (padrão 4, máximo 8)" },
      },
    },
  },
  {
    name: "detalhes_imovel",
    description:
      "Retorna todos os dados de um imóvel pelo código (ex.: QI1626): descrição completa, condomínio, IPTU, características e link.",
    input_schema: {
      type: "object",
      properties: { codigo: { type: "string" } },
      required: ["codigo"],
    },
  },
  {
    name: "abrir_ficha_busca",
    description:
      "Mostra ao visitante a ficha de BUSCA PERSONALIZADA, para quem quer COMPRAR e não encontrou o imóvel no site: o Antônio procura no mercado. Use quando a busca não encontrar nada, quando nenhum imóvel mostrado servir ou quando o visitante pedir. Preencha com tudo o que o visitante já contou; nome, telefone e e-mail ele mesmo digita na ficha.",
    input_schema: {
      type: "object",
      properties: {
        tipo: { type: "string", description: "Apartamento, Casa, Casa em condomínio, Cobertura, Sala comercial ou Outro" },
        bairros: { type: "array", items: { type: "string" } },
        quartos_min: { type: "integer" },
        suite: { type: "boolean" },
        vagas_min: { type: "integer" },
        area_min: { type: "number" },
        preco_max: { type: "number", description: "Valor máximo que o visitante disse que pode investir, em reais. Só se ele informou." },
        valor_indefinido: {
          type: "boolean",
          description: "true se o visitante disse que não sabe quanto pode investir ou que quer simular o financiamento",
        },
        pagamento: { type: "string", description: "À vista, Financiamento, Permuta ou Ainda não sei" },
        permuta: { type: "string", description: "Se vai dar um imóvel na permuta, qual é (tipo, bairro)" },
        prazo: { type: "string", description: "Até 3 meses, De 3 a 6 meses, Mais de 6 meses ou Só pesquisando" },
        caracteristicas: {
          type: "string",
          description: "Outros desejos citados: varanda, andar alto, vista, aceita pet, perto de escola etc.",
        },
      },
    },
  },
  {
    name: "abrir_ficha_venda",
    description:
      "Mostra ao visitante a ficha de CAPTAÇÃO, para quem quer VENDER o próprio imóvel com a Quinto Imóveis. Use sempre que o visitante disser que quer vender, anunciar ou avaliar o imóvel dele. Preencha com o que ele já contou; nome, telefone e e-mail ele mesmo digita.",
    input_schema: {
      type: "object",
      properties: {
        tipo: { type: "string", description: "Apartamento, Casa, Casa em condomínio, Cobertura, Sala comercial ou Outro" },
        bairro: { type: "string" },
        endereco: { type: "string", description: "Rua e número, só se o visitante informou" },
        quartos: { type: "integer" },
        vagas: { type: "integer" },
        area: { type: "number", description: "Área útil em m²" },
        valor_pretendido: { type: "number", description: "Em reais, só se o visitante informou" },
        situacao: { type: "string", description: "Desocupado, Ocupado pelo proprietário ou Alugado" },
        documentacao: {
          type: "string",
          description: "Escritura registrada no RGI, Inventário em andamento, Ainda financiado ou Não sei informar",
        },
        aceita_permuta: { type: "string", description: "Não, Sim ou Talvez" },
        prazo: { type: "string", description: "Até 3 meses, De 3 a 6 meses, Mais de 6 meses ou Não definido" },
        observacoes: { type: "string" },
      },
    },
  },
  {
    name: "contato_imovel",
    description:
      "Prepara o envio do interesse do visitante num imóvel ESPECÍFICO do catálogo (agendar visita, fazer proposta ou pedir mais informações) pelo formulário da página desse imóvel. O pedido cai no CRM ligado ao imóvel. Nome, telefone e e-mail o visitante digita.",
    input_schema: {
      type: "object",
      properties: {
        codigo: { type: "string", description: "Código do imóvel, ex.: QI1626" },
        interesse: { type: "string", enum: ["visita", "proposta", "informacoes"] },
        resumo: {
          type: "string",
          description: "Uma ou duas frases, em primeira pessoa, com o que o visitante quer saber ou propor. Ex.: 'Posso visitar no sábado de manhã. Queria saber se aceita financiamento.'",
        },
      },
      required: ["codigo", "interesse"],
    },
  },
  {
    name: "encaminhar_whatsapp",
    description:
      "Prepara a conversa no WhatsApp com o corretor Antônio, com um resumo já escrito. O visitante informa nome e telefone e o contato é registrado no CRM antes de abrir o WhatsApp. Use quando o visitante preferir o WhatsApp ou quiser falar com uma pessoa.",
    input_schema: {
      type: "object",
      properties: {
        resumo: {
          type: "string",
          description: "Uma ou duas frases com o que o visitante procura ou quer, em primeira pessoa",
        },
        codigos: { type: "array", items: { type: "string" }, description: "Códigos dos imóveis de interesse" },
      },
      required: ["resumo"],
    },
  },
];

const TEXTO_LIMITE =
  "Nossa conversa já está bem completa! Para continuar, o corretor Antônio Quinto atende você pessoalmente: deixe seus dados ou chame no WhatsApp.";

const ACAO_PADRAO_WHATSAPP = (env) => ({
  tipo: "whatsapp",
  link: linkWhatsApp(env, "Olá, Antônio! Vim pelo site e gostaria de atendimento."),
});

// Configuração padrão. Qualquer variável criada no painel da Cloudflare (ou no
// wrangler.toml) com o mesmo nome substitui o valor daqui. As CHAVES nunca ficam aqui:
// são cadastradas como "Secret" (ex.: OPENAI_API_KEY, ANTHROPIC_API_KEY).
export const PADROES = {
  ORIGENS_PERMITIDAS: "https://www.quintoimoveis.com.br,https://quintoimoveis.com.br,https://corretorquinto.github.io",
  CATALOGO_URL: "https://corretorquinto.github.io/quinto-chat/catalogo/catalogo.json",
  WHATSAPP: "5521981036246",
  PROVEDOR_ATIVO: "OPENAI",
  PROVEDOR_RESERVA: "",
  OPENAI_MODELO: "gpt-6-luna",
  ANTHROPIC_MODELO: "claude-haiku-5-5",
  DEEPSEEK_MODELO: "deepseek-flash",
  GEMINI_MODELO: "gemini-2.5-flash-lite",
  // Calculadora indicada na ficha de busca ("Ainda não sei") e nas respostas do agente.
  // Para trocar pela calculadora nova, crie a variável CALCULADORA_URL no painel da Cloudflare.
  CALCULADORA_URL: "https://www.quintoimoveis.com.br/calculadora-financiamento",
};

export default {
  async fetch(req, envOriginal) {
    const env = { ...PADROES };
    for (const k in envOriginal || {}) if (envOriginal[k] !== undefined && envOriginal[k] !== "") env[k] = envOriginal[k];
    const url = new URL(req.url);
    const origem = req.headers.get("Origin") || "";
    const permitidas = (env.ORIGENS_PERMITIDAS || "").split(",").map((s) => s.trim()).filter(Boolean);
    const origemOk = permitidas.includes(origem);
    const cors = origemOk
      ? {
          "Access-Control-Allow-Origin": origem,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
          Vary: "Origin",
        }
      : {};

    if (req.method === "OPTIONS") return new Response(null, { status: origemOk ? 204 : 403, headers: cors });

    if (url.pathname === "/saude" && req.method === "GET") {
      // Mostra qual provedor/modelo está em uso (nunca a chave)
      const provedores = provedoresConfigurados(env).map((p) => ({
        provedor: p.nome,
        modelo: p.modelo || null,
        pronto: !p.erro,
        ...(p.erro ? { problema: p.erro } : {}),
      }));
      try {
        const cat = await carregarCatalogo(env.CATALOGO_URL);
        return json({ ok: true, imoveis: cat.imoveis.length, gerado_em: cat.gerado_em, provedores }, 200, cors);
      } catch (e) {
        return json({ ok: false, erro: "catálogo indisponível", provedores }, 503, cors);
      }
    }

    if (url.pathname !== "/chat" || req.method !== "POST") return json({ erro: "não encontrado" }, 404, cors);
    if (!origemOk) return json({ erro: "origem não permitida" }, 403);

    const ip = req.headers.get("CF-Connecting-IP") || "local";
    if (!dentroDoLimite(ip)) {
      return json(
        {
          texto: "Você enviou muitas mensagens em pouco tempo. Para continuar agora, fale direto com o corretor Antônio Quinto pelo WhatsApp.",
          imoveis: [],
          acao: ACAO_PADRAO_WHATSAPP(env),
        },
        429,
        cors
      );
    }

    let corpo;
    try {
      corpo = await req.json();
    } catch {
      return json({ erro: "JSON inválido" }, 400, cors);
    }
    const mensagens = limparHistorico(corpo?.mensagens);
    if (!mensagens) return json({ erro: "mensagens inválidas" }, 400, cors);

    // Conversa longa demais: não chama o modelo, entrega ao corretor
    const rodada = Number(corpo?.rodada) || 0;
    if (rodada > LIMITE_CONVERSA) {
      return json({ texto: TEXTO_LIMITE, imoveis: [], acao: ACAO_PADRAO_WHATSAPP(env), limite: true }, 200, cors);
    }

    try {
      const resultado = await atender(env, mensagens, corpo?.pagina || {}, { rodada, contato: corpo?.contato === true });
      return json(resultado, 200, cors);
    } catch (e) {
      console.log("erro_atendimento", String(e?.message || e).slice(0, 300));
      return json(
        {
          texto:
            "Tive um problema técnico para responder agora. Se preferir, fale direto com o corretor Antônio Quinto pelo WhatsApp, o atendimento é 24 horas.",
          imoveis: [],
          acao: ACAO_PADRAO_WHATSAPP(env),
          erro: true,
        },
        200,
        cors
      );
    }
  },
};

const FERRAMENTAS_NEUTRAS = FERRAMENTAS.map((f) => ({ nome: f.name, descricao: f.description, parametros: f.input_schema }));

export async function atender(env, mensagens, pagina, conversaInfo = {}) {
  const catalogo = await carregarCatalogo(env.CATALOGO_URL);
  const imoveis = catalogo.imoveis;
  const imovelDaPagina = acharPorUrl(imoveis, pagina.url);
  const sistema = {
    // Parte fixa primeiro: entra no cache de prompt e barateia as chamadas seguintes
    fixo: `${INSTRUCOES.split("{{CALCULADORA}}").join(env.CALCULADORA_URL || PADROES.CALCULADORA_URL)}\n\n${resumoDoCatalogo(imoveis)}`,
    variavel: contextoDaPagina(pagina, imovelDaPagina, conversaInfo),
  };

  // Tenta o provedor ativo; se falhar, o de reserva (quando configurado)
  const provedores = provedoresConfigurados(env);
  let ultimoErro = new Error("nenhum provedor configurado");
  for (const cfg of provedores) {
    try {
      const r = await conversar(cfg, sistema, mensagens, imoveis, env);
      // Registro sem conteúdo da conversa (LGPD): provedor, ferramentas e consumo de tokens
      console.log(
        JSON.stringify({ evento: "chat", provedor: cfg.nome, modelo: cfg.modelo, ferramentas: r.usadas, acao: r.acao ? r.acao.tipo : null, tokens: r.uso })
      );
      const cartoes = cartoesCitados(r.texto, imoveis, imovelDaPagina);
      const partes = separarLista(r.texto, cartoes);
      // texto: antes dos cartões; texto_depois: depois deles; historico: o texto completo,
      // que volta ao modelo na próxima mensagem (para ele saber quais imóveis mostrou)
      return {
        texto: partes.antes,
        ...(partes.depois ? { texto_depois: partes.depois } : {}),
        ...(partes.antes !== r.texto ? { historico: r.texto } : {}),
        imoveis: cartoes,
        acao: r.acao,
      };
    } catch (e) {
      ultimoErro = e;
      console.log(JSON.stringify({ evento: "falha_provedor", provedor: cfg.nome, erro: String(e && e.message || e).slice(0, 200) }));
    }
  }
  throw ultimoErro;
}

async function conversar(cfg, sistema, mensagens, imoveis, env) {
  const conversa = mensagens.map((m) => ({ role: m.role, texto: m.content }));
  const contexto = {
    textoVisitante: mensagens.filter((m) => m.role === "user").map((m) => m.content).join("\n"),
    bairros: [...new Set(imoveis.map((i) => i.bairro).filter(Boolean))],
  };
  const usadas = [];
  const uso = { entrada: 0, cache: 0, saida: 0 };
  let acao = null;
  let texto = "";

  for (let volta = 1; volta <= MAX_VOLTAS; volta++) {
    const ultima = volta === MAX_VOLTAS;
    const resp = await chamarModelo(cfg, {
      sistema,
      mensagens: conversa,
      ferramentas: FERRAMENTAS_NEUTRAS,
      forcarTexto: ultima,
      maxTokens: 1500,
    });
    uso.entrada += resp.uso.entrada;
    uso.cache += resp.uso.cache;
    uso.saida += resp.uso.saida;

    if (!resp.chamadas.length || ultima) {
      texto = resp.texto;
      break;
    }

    conversa.push({ role: "assistant", texto: resp.texto, chamadas: resp.chamadas });
    const resultados = resp.chamadas.map((p) => {
      usadas.push(p.nome);
      const saida = executarFerramenta(p.nome, p.args || {}, imoveis, env, contexto);
      if (saida.acao) acao = saida.acao; // vale a última ação pedida
      return { id: p.id, nome: p.nome, conteudo: JSON.stringify(saida.paraModelo) };
    });
    conversa.push({ role: "ferramenta", resultados });
  }

  if (!texto) texto = "Pode me contar um pouco mais do que você procura? Bairro, quartos e faixa de preço já ajudam.";
  return { texto, acao, usadas, uso };
}

const AVISO_FICHA =
  "A ficha aparece logo abaixo da sua resposta, preenchida com o que o visitante contou. Diga, de forma natural e em uma ou duas frases, que ele só precisa conferir, completar o que faltar e tocar em Enviar; o site abre o formulário do Antônio já preenchido, e ele só digita o código de 4 números. Se quiser, lembre que ele pode tocar em \"Prefiro falar no WhatsApp\". Não escreva o número do WhatsApp e não use a expressão \"está na tela\".";

export function executarFerramenta(nome, entrada, imoveis, env, contexto = {}) {
  if (nome === "buscar_imoveis") {
    const r = buscar(imoveis, entrada);
    if (r.total === 0) {
      r.dica =
        "Nada no catálogo com esses critérios. Diga isso com sinceridade e ofereça a busca personalizada: o Antônio procura no mercado (abrir_ficha_busca) ou o visitante fala direto no WhatsApp (encaminhar_whatsapp).";
    }
    return { paraModelo: r };
  }
  if (nome === "detalhes_imovel") {
    const i = acharPorCodigo(imoveis, entrada.codigo);
    return { paraModelo: i ? detalhes(i) : { erro: `Imóvel ${entrada.codigo} não encontrado no catálogo atual.` } };
  }
  if (nome === "abrir_ficha_busca") {
    const e = completarFicha("busca", entrada, contexto.textoVisitante, contexto.bairros);
    return {
      acao: { tipo: "ficha_busca", dados: prefillBusca(e), calculadora: env.CALCULADORA_URL || PADROES.CALCULADORA_URL },
      paraModelo: { ok: true, aviso: AVISO_FICHA },
    };
  }
  if (nome === "abrir_ficha_venda") {
    const e = completarFicha("venda", entrada, contexto.textoVisitante, contexto.bairros);
    return { acao: { tipo: "ficha_venda", dados: prefillVenda(e) }, paraModelo: { ok: true, aviso: AVISO_FICHA } };
  }
  if (nome === "contato_imovel") {
    const i = acharPorCodigo(imoveis, entrada.codigo);
    if (!i) return { paraModelo: { erro: `Imóvel ${entrada.codigo} não encontrado no catálogo atual.` } };
    return {
      acao: {
        tipo: "contato_imovel",
        codigo: i.codigo,
        id: i.id,
        url: i.url,
        titulo: i.titulo || `${i.tipo} em ${i.bairro}`,
        mensagem: mensagemImovel(i, entrada.interesse, entrada.resumo),
      },
      paraModelo: {
        ok: true,
        aviso:
          "O pedido aparece logo abaixo da sua resposta. Diga, de forma natural e em uma ou duas frases, que ele completa nome, telefone e e-mail e toca em Enviar; o site abre o formulário do imóvel já preenchido e ele só digita o código de 4 números. O Antônio responde em seguida. Não use a expressão \"está na tela\".",
      },
    };
  }
  if (nome === "encaminhar_whatsapp") {
    const linhas = ["Olá, Antônio! Vim pelo assistente do site."];
    linhas.push(String(entrada.resumo || "").trim().slice(0, 400));
    const codigos = [].concat(entrada.codigos || []).slice(0, 5);
    for (const c of codigos) {
      const i = acharPorCodigo(imoveis, c);
      if (i) linhas.push(`#${i.codigo} - ${i.url}`);
    }
    const textoZap = linhas.filter(Boolean).join("\n");
    return {
      acao: { tipo: "whatsapp", texto: textoZap, link: linkWhatsApp(env, textoZap) },
      paraModelo: {
        ok: true,
        aviso:
          "Logo abaixo da sua resposta aparecem os campos de nome e telefone e o botão \"Enviar mensagem pelo WhatsApp\". Responda em uma frase natural e cordial, por exemplo: \"Claro! É só informar seu nome e telefone abaixo e tocar em Enviar mensagem pelo WhatsApp: a conversa com o corretor Antônio Quinto abre com a mensagem pronta.\" Não escreva o número e não diga que o botão \"está na tela\".",
      },
    };
  }
  return { paraModelo: { erro: "ferramenta desconhecida" } };
}

function contextoDaPagina(pagina, imovel, info = {}) {
  const hoje = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const partes = [`Data de hoje: ${hoje}.`];
  if (EMPURRAO_EM.includes(info.rodada) && !info.contato) {
    partes.push(
      `AVISO: esta é a mensagem número ${info.rodada} do visitante e ele ainda não deixou contato. Responda o que ele perguntou e, nesta mesma resposta, ofereça que o corretor Antônio Quinto continue o atendimento, usando a ferramenta adequada (veja "Conversa longa").`
    );
  }
  if (imovel) {
    partes.push(
      `O visitante está na página do imóvel #${imovel.codigo} (${imovel.titulo || imovel.tipo}, ${imovel.bairro}). Use detalhes_imovel para responder sobre ele e contato_imovel se ele quiser visita, proposta ou mais informações.`
    );
  } else if (pagina.titulo) {
    partes.push(`O visitante está na página: ${String(pagina.titulo).slice(0, 120)}.`);
  }
  return partes.join(" ");
}

export function cartoesCitados(texto, imoveis, imovelDaPagina) {
  const vistos = new Set();
  const cartoes = [];
  for (const m of texto.matchAll(/#([A-Za-z]{0,4}\d{2,8})\b/g)) {
    const i = acharPorCodigo(imoveis, m[1]);
    if (!i || vistos.has(i.codigo) || (imovelDaPagina && i.codigo === imovelDaPagina.codigo)) continue;
    vistos.add(i.codigo);
    cartoes.push(cartao(i));
    if (cartoes.length >= MAX_CARTOES) break;
  }
  return cartoes;
}

// Tira do texto as linhas que só listam imóveis que viraram cartão (o cartão já mostra
// foto, bairro, quartos e preço). Devolve o que vem antes e o que vem depois da lista.
export function separarLista(texto, cartoes) {
  const codigos = new Set((cartoes || []).map((c) => String(c.codigo).toUpperCase()));
  const linhas = String(texto || "").split("\n");
  const ehItem = (l) => {
    const m = l.trim().replace(/^(?:[-*•–—]|\d+[.)])\s*/, "").replace(/^\*\*/, "").match(/^#([A-Za-z]{0,4}\d{2,8})\b/);
    return !!(m && codigos.has(m[1].toUpperCase()));
  };
  const itens = linhas.map(ehItem);
  const primeiro = itens.indexOf(true);
  if (!codigos.size || primeiro < 0) return { antes: String(texto || "").trim(), depois: "" };
  const ultimo = itens.lastIndexOf(true);
  const limpar = (ls) => ls.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const antes = limpar(linhas.slice(0, primeiro));
  const meio = linhas.slice(primeiro, ultimo + 1).filter((l, i) => !itens[primeiro + i] && l.trim());
  const depois = limpar([...meio, ...linhas.slice(ultimo + 1)]);
  return { antes: antes || "Veja estas opções:", depois };
}

export function limparHistorico(lista) {
  if (!Array.isArray(lista) || lista.length === 0) return null;
  const saida = [];
  for (const m of lista.slice(-MAX_MENSAGENS)) {
    const role = m?.role === "assistant" ? "assistant" : m?.role === "user" ? "user" : null;
    const content = typeof m?.content === "string" ? m.content.trim() : "";
    if (!role || !content) continue;
    const limite = role === "user" ? MAX_CARACTERES : 2000;
    const texto = content.slice(0, limite);
    const anterior = saida[saida.length - 1];
    if (anterior && anterior.role === role) anterior.content += "\n" + texto; // junta mensagens seguidas
    else saida.push({ role, content: texto });
  }
  while (saida.length && saida[0].role !== "user") saida.shift();
  if (!saida.length || saida[saida.length - 1].role !== "user") return null;
  return saida;
}

// Limites por IP (por janela de tempo). Valem por servidor do Cloudflare: são uma
// proteção aproximada; o limite de 15 mensagens por visita fica no chat e no /chat.
export function dentroDoLimite(chave, agora = Date.now(), limites = [LIMITE, LIMITE_DIA]) {
  const lista = Array.isArray(limites) ? limites : [limites];
  const maiorJanela = Math.max(...lista.map((l) => l.janelaMs));
  const recentes = (visitas.get(chave) || []).filter((t) => agora - t < maiorJanela);
  for (const l of lista) {
    if (recentes.filter((t) => agora - t < l.janelaMs).length >= l.mensagens) {
      visitas.set(chave, recentes);
      return false;
    }
  }
  recentes.push(agora);
  visitas.set(chave, recentes);
  if (visitas.size > 5000) {
    for (const [k, v] of visitas) if (agora - v[v.length - 1] > LIMITE_DIA.janelaMs) visitas.delete(k);
  }
  return true;
}

function linkWhatsApp(env, texto) {
  return `https://wa.me/${env.WHATSAPP || "5521981036246"}?text=${encodeURIComponent(texto)}`;
}

function json(dados, status = 200, headers = {}) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}
