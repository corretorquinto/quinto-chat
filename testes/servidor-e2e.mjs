// Servidor de teste: imita o site do ImobiBrasil (páginas em ISO-8859-1, formulários nativos)
// e roda o Worker de verdade com a API do Claude simulada.
// Uso: node testes/servidor-e2e.mjs  (porta 8790)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import worker from "../worker/src/index.js";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(DIR, "..");
const PORTA = 8790;
const ORIGEM = `http://127.0.0.1:${PORTA}`;

const CATALOGO = {
  gerado_em: "2026-11-04T00:00:00+00:00",
  imoveis: [
    { id: "4383031", codigo: "QI1626", tipo: "Apartamento", bairro: "Santa Rosa", endereco: "Rua Mário Viana", preco: 400000, quartos: 2, suites: 1, vagas: 1, area: 80, condominio: 1128, iptu: 113, titulo: "Apartamento 2 quartos com suíte em Santa Rosa | Quinto", descricao: "Silêncio perto de tudo.", caracteristicas: [], url: `${ORIGEM}/imovel/4383031/apartamento-venda-niteroi-rj-santa-rosa`, foto: "" },
    { id: "4378274", codigo: "QI1623", tipo: "Apartamento", bairro: "Icaraí", endereco: "Rua Otávio Carneiro, 100", preco: 599000, quartos: 3, suites: 1, vagas: 1, area: 100, titulo: "Apartamento 3 quartos com suíte, 100 m² em Icaraí", descricao: "Varanda.", caracteristicas: [], url: `${ORIGEM}/imovel/4378274/apartamento-venda-niteroi-rj-icarai`, foto: "" },
  ],
};

const usar = (name, input) => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "t" + Math.random().toString(36).slice(2), name, input }] });
const falar = (text) => ({ stop_reason: "end_turn", content: [{ type: "text", text }] });

// API do Claude simulada: decide pela última mensagem do visitante
function claudeSimulado(corpo) {
  const ultima = corpo.messages.at(-1);
  if (Array.isArray(ultima.content)) return falar("Pronto! Confira a ficha, complete seus dados e toque em Enviar.");
  const t = ultima.content.toLowerCase();
  if (t.includes("não achei")) return usar("abrir_ficha_busca", { tipo: "apartamento", bairros: ["Icaraí", "Santa Rosa"], quartos_min: 3, suite: true, preco_max: 900000, pagamento: "financiamento", caracteristicas: "varanda, andar alto" });
  if (t.includes("vender")) return usar("abrir_ficha_venda", { tipo: "cobertura", bairro: "Icaraí", quartos: 3, vagas: 2, area: 150, aceita_permuta: "talvez" });
  if (t.includes("visita")) return usar("contato_imovel", { codigo: "QI1626", interesse: "visita", resumo: "Posso visitar no sábado de manhã." });
  if (t.includes("whatsapp")) return usar("encaminhar_whatsapp", { resumo: "Quero saber mais sobre o apartamento de Santa Rosa.", codigos: ["QI1626"] });
  if (t.includes("lista de imóveis")) return falar("Encontrei 2 opções. Veja:\n#QI1626 — Santa Rosa, 2 quartos — R$ 400.000\n#QI1623 — Icaraí, 3 quartos — R$ 599.000\nSe nenhuma servir, o Antônio procura no mercado.");
  if (t.includes("quanto custa")) return falar("O condomínio é R$ 1.128 e o IPTU é R$ 113. Se preferir, o telefone é (21) 98103-6246.");
  if (t.includes("não sei quanto")) return usar("abrir_ficha_busca", { valor_indefinido: true });
  if (t.includes("obrigado, vou encerrar")) return usar("abrir_ficha_busca", { bairros: ["Icaraí"] });
  if (t.includes("só oi")) return usar("encaminhar_whatsapp", { resumo: "Quero falar com o corretor Antônio Quinto." });
  return falar("Posso ajudar a encontrar um imóvel. Qual bairro?");
}

// Mesma lógica no formato OpenAI (vale para DeepSeek, Gemini e demais compatíveis)
function openaiSimulado(corpo) {
  const ultima = corpo.messages.at(-1);
  const r = ultima.role === "tool" ? claudeSimulado({ messages: [{ content: [] }] }) : claudeSimulado({ messages: [{ content: ultima.content }] });
  const b = r.content[0];
  if (b.type === "tool_use") {
    return { choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input) } }] } }], usage: {} };
  }
  return { choices: [{ finish_reason: "stop", message: { role: "assistant", content: b.text } }], usage: {} };
}

const PROVEDOR = (process.env.PROVEDOR || "ANTHROPIC").toUpperCase();
globalThis.fetch = async (url, opts) => {
  if (String(url).includes("catalogo.json")) return new Response(JSON.stringify(CATALOGO));
  if (String(url).includes("api.anthropic.com")) return new Response(JSON.stringify(claudeSimulado(JSON.parse(opts.body))));
  if (String(url).includes("/chat/completions")) return new Response(JSON.stringify(openaiSimulado(JSON.parse(opts.body))));
  throw new Error("rede bloqueada no teste: " + url);
};

const ENV = {
  PROVEDOR_ATIVO: PROVEDOR,
  ANTHROPIC_MODELO: "claude-haiku-5-5", ANTHROPIC_API_KEY: "x",
  OPENAI_MODELO: "gpt-6-luna", OPENAI_API_KEY: "x",
  DEEPSEEK_MODELO: "deepseek-flash", DEEPSEEK_API_KEY: "x",
  GEMINI_MODELO: "gemini-2.5-flash-lite", GEMINI_API_KEY: "x",
  CATALOGO_URL: "http://local/catalogo.json", ORIGENS_PERMITIDAS: ORIGEM, WHATSAPP: "5521981036246",
};
const registros = [];

function pagina(arquivo, { imovel = "", caminho = "/", balao = null, volta = null, cookies = null, mic = null } = {}) {
  const ler = (f) => fs.readFileSync(path.join(DIR, "site", f), "utf8");
  const tag = fs.existsSync(path.join(RAIZ, "gtm", "whatsapp-inteligente-v3.html")) ? '<script src="/gtm/tag.js"></script>' : "";
  return ler(arquivo)
    .replace("__WHATS__", ler("whats.html").replace("__IMOVEL__", imovel).replace("__PATH__", caminho))
    .replace(
      "__SCRIPTS__",
      tag +
        `<script src="/widget/quinto-chat.js" data-api="${ORIGEM}" data-catalogo="/catalogo.json"${balao ? ` data-balao-segundos="${Number(balao)}"` : ""}${volta ? ` data-balao-volta-minutos="${Number(volta)}"` : ""}${cookies ? ` data-cookies-espera-segundos="${Number(cookies)}"` : ""}${mic ? ` data-mic-pausa-segundos="${Number(mic)}"` : ""} defer></script>`
    );
}

function enviarLatin1(res, html, status = 200) {
  res.writeHead(status, { "Content-Type": "text/html; charset=iso-8859-1" });
  res.end(Buffer.from(html, "latin1"));
}

http
  .createServer(async (req, res) => {
    const u = new URL(req.url, ORIGEM);
    const partes = [];
    for await (const p of req) partes.push(p);
    const corpo = Buffer.concat(partes);

    if (u.pathname === "/__ultimo") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(globalThis.__ultimoPedido || null));
    }
    if (u.pathname === "/__registros") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(registros));
    }
    if (u.pathname === "/widget/quinto-chat.js" || u.pathname === "/site/comum.js") {
      const f = u.pathname === "/site/comum.js" ? path.join(DIR, "site", "comum.js") : path.join(RAIZ, "widget", "quinto-chat.js");
      res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      return res.end(fs.readFileSync(f));
    }
    if (u.pathname === "/gtm/tag.js") {
      const html = fs.readFileSync(path.join(RAIZ, "gtm", "whatsapp-inteligente-v3.html"), "utf8");
      res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      return res.end(html.replace(/^\s*<script>|<\/script>\s*$/g, ""));
    }
    if (req.method === "POST" && (u.pathname.startsWith("/contato") || u.pathname.startsWith("/imovel-mais-info"))) {
      registros.push({ rota: u.pathname + u.search, corpo: corpo.toString("latin1") });
      if (u.search.includes("acao=whats")) {
        res.writeHead(302, { Location: "https://web.whatsapp.com/send?phone=5521981036246&text=generica" });
        return res.end();
      }
      if (u.pathname.startsWith("/contato")) return enviarLatin1(res, pagina("inicio.html").replace("<h1>Quinto Imóveis</h1>", "<h1>Fale Conosco</h1><p>Obrigado por entrar em contato conosco. Sua mensagem foi enviada com sucesso.</p>"));
      return enviarLatin1(res, "<p>ok</p>");
    }
    if (u.pathname === "/contato" || u.pathname === "/contato/") return enviarLatin1(res, pagina("contato.html", { caminho: "/contato" }));
    const im = u.pathname.match(/^\/imovel\/(\d+)\//);
    if (im) return enviarLatin1(res, pagina("imovel.html", { imovel: im[1], caminho: u.pathname, balao: u.searchParams.get("balao"), volta: u.searchParams.get("volta"), cookies: u.searchParams.get("cookies") }));
    const opcoes = { caminho: u.pathname, balao: u.searchParams.get("balao"), volta: u.searchParams.get("volta"), mic: u.searchParams.get("mic") };
    if (u.pathname === "/") return enviarLatin1(res, pagina("inicio.html", opcoes));
    if (u.pathname.startsWith("/noticia/")) return enviarLatin1(res, pagina(u.pathname.includes("santa-rosa") ? "noticia-bairro.html" : "noticia.html", opcoes));
    if (u.pathname.startsWith("/cat/")) return enviarLatin1(res, pagina("lista.html", opcoes));
    if (u.pathname.startsWith("/bairro/")) return enviarLatin1(res, pagina("noticia-bairro.html", opcoes).replace(' class="noticias__title__data"', ""));
    if (["/imovel/", "/seu-imovel", "/financiamento", "/calculadora-financiamento", "/correspondente", "/sobre", "/noticias"].includes(u.pathname))
      return enviarLatin1(res, pagina("inicio.html", opcoes));
    if (u.pathname === "/catalogo.json") {
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify(CATALOGO));
    }
    if (["/chat", "/saude"].includes(u.pathname)) {
      // cada navegador de teste usa um "IP" próprio (o limite por IP vale por cenário)
      if (req.method === "POST") {
        try {
          globalThis.__ultimoPedido = JSON.parse(corpo);
        } catch {}
      }
      const headers = { ...req.headers, "cf-connecting-ip": req.headers["x-teste-ip"] || req.headers["user-agent"] || "local" };
      const r = await worker.fetch(new Request(ORIGEM + req.url, { method: req.method, headers, body: ["GET", "HEAD", "OPTIONS"].includes(req.method) ? undefined : corpo }), ENV);
      res.writeHead(r.status, Object.fromEntries(r.headers));
      return res.end(Buffer.from(await r.arrayBuffer()));
    }
    res.writeHead(404);
    res.end();
  })
  .listen(PORTA, () => console.log("pronto em " + ORIGEM + " com o provedor " + PROVEDOR));
