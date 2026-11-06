// Provedores de IA: o agente funciona com qualquer LLM.
//
// Como escolher (worker/wrangler.toml, seção [vars]):
//   PROVEDOR_ATIVO  = "ANTHROPIC"   provedor usado no atendimento
//   PROVEDOR_RESERVA = "OPENAI"     opcional: usado se o ativo falhar (fora do ar, sem crédito)
//
// Para cada provedor (troque ANTHROPIC pelo nome dele):
//   ANTHROPIC_MODELO   nome do modelo (obrigatório)
//   ANTHROPIC_API_URL  endereço da API (já vem preenchido para os provedores conhecidos)
//   ANTHROPIC_FORMATO  "anthropic" ou "openai" (já vem preenchido para os conhecidos)
//   ANTHROPIC_API_KEY  a chave, cadastrada como SECRET: npx wrangler secret put ANTHROPIC_API_KEY
//
// Dois formatos cobrem praticamente o mercado inteiro:
//   "anthropic" -> API da Anthropic (Claude)
//   "openai"    -> API da OpenAI e todas as "compatíveis com OpenAI": DeepSeek, Gemini, Groq,
//                  Mistral, xAI, OpenRouter, Together, Ollama etc.
// Um provedor novo que não está na lista abaixo funciona definindo {NOME}_FORMATO = "openai",
// {NOME}_API_URL, {NOME}_MODELO e o secret {NOME}_API_KEY. Nenhuma linha de código muda.

export const CONHECIDOS = {
  ANTHROPIC: { formato: "anthropic", url: "https://api.anthropic.com/v1/messages" },
  OPENAI: { formato: "openai", url: "https://api.openai.com/v1/chat/completions", campoLimite: "max_completion_tokens", esforco: "none" },
  DEEPSEEK: { formato: "openai", url: "https://api.deepseek.com/chat/completions" },
  GEMINI: { formato: "openai", url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions" },
  GROQ: { formato: "openai", url: "https://api.groq.com/openai/v1/chat/completions" },
  MISTRAL: { formato: "openai", url: "https://api.mistral.ai/v1/chat/completions" },
  XAI: { formato: "openai", url: "https://api.x.ai/v1/chat/completions" },
  OPENROUTER: { formato: "openai", url: "https://openrouter.ai/api/v1/chat/completions" },
};

// Lê a configuração de um provedor a partir das variáveis do Worker
export function configDoProvedor(env, nome) {
  const n = String(nome || "").trim().toUpperCase();
  if (!n) return null;
  const base = CONHECIDOS[n] || {};
  const legado = n === "ANTHROPIC" ? env.MODELO : undefined; // versões antigas usavam só MODELO
  const cfg = {
    nome: n,
    formato: String(env[`${n}_FORMATO`] || base.formato || "openai").toLowerCase(),
    url: env[`${n}_API_URL`] || base.url,
    modelo: env[`${n}_MODELO`] || legado,
    chave: env[`${n}_API_KEY`],
    campoLimite: env[`${n}_CAMPO_LIMITE`] || base.campoLimite || "max_tokens",
    // Esforço de raciocínio (só formato openai). Os modelos GPT-6 não aceitam ferramentas no
    // /chat/completions com raciocínio ligado; "none" desliga. Variável no painel: OPENAI_ESFORCO
    // ("padrao" = não enviar o parâmetro).
    esforco: env[`${n}_ESFORCO`] || base.esforco || "",
  };
  const faltando = ["url", "modelo", "chave"].filter((k) => !cfg[k]);
  if (faltando.length) cfg.erro = `provedor ${n} sem ${faltando.join(", ")}`;
  if (!["anthropic", "openai"].includes(cfg.formato)) cfg.erro = `formato desconhecido: ${cfg.formato}`;
  return cfg;
}

export function provedoresConfigurados(env) {
  const ativo = configDoProvedor(env, env.PROVEDOR_ATIVO || "ANTHROPIC");
  const reserva = env.PROVEDOR_RESERVA ? configDoProvedor(env, env.PROVEDOR_RESERVA) : null;
  return [ativo, reserva].filter(Boolean);
}

// ---------------------------------------------------------------------------
// Formato neutro usado pelo agente
//   sistema:    { fixo, variavel }  (o fixo vem primeiro e entra no cache de prompt)
//   mensagens:  { role: "user", texto }
//               { role: "assistant", texto, chamadas: [{ id, nome, args }] }
//               { role: "ferramenta", resultados: [{ id, nome, conteudo }] }
//   ferramentas:{ nome, descricao, parametros }  (JSON Schema)
// Resposta:     { texto, chamadas: [{ id, nome, args }], uso: { entrada, saida, cache } }
// ---------------------------------------------------------------------------
export async function chamarModelo(cfg, pedido) {
  if (cfg.erro) throw new Error(cfg.erro);
  return cfg.formato === "anthropic" ? chamarAnthropic(cfg, pedido) : chamarOpenAI(cfg, pedido);
}

async function postar(cfg, headers, corpo) {
  const resp = await fetch(cfg.url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(30000),
  });
  if (!resp.ok) {
    const detalhe = await resp.text().catch(() => "");
    throw new Error(`${cfg.nome} ${resp.status}: ${detalhe.slice(0, 200)}`);
  }
  return resp.json();
}

// ----------------------------- Anthropic -----------------------------------
async function chamarAnthropic(cfg, { sistema, mensagens, ferramentas, forcarTexto, maxTokens }) {
  const corpo = {
    model: cfg.modelo,
    max_tokens: maxTokens,
    system: [
      { type: "text", text: sistema.fixo, cache_control: { type: "ephemeral" } },
      ...(sistema.variavel ? [{ type: "text", text: sistema.variavel }] : []),
    ],
    tools: ferramentas.map((f) => ({ name: f.nome, description: f.descricao, input_schema: f.parametros })),
    ...(forcarTexto ? { tool_choice: { type: "none" } } : {}),
    messages: mensagens.map(paraAnthropic),
  };
  const r = await postar(cfg, { "x-api-key": cfg.chave, "anthropic-version": "2023-06-01" }, corpo);
  const blocos = Array.isArray(r.content) ? r.content : [];
  const u = r.usage || {};
  return {
    texto: blocos.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim(),
    chamadas: blocos.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id, nome: b.name, args: b.input || {} })),
    uso: {
      entrada: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0),
      cache: u.cache_read_input_tokens || 0,
      saida: u.output_tokens || 0,
    },
  };
}

function paraAnthropic(m) {
  if (m.role === "user") return { role: "user", content: m.texto };
  if (m.role === "assistant") {
    const content = [];
    if (m.texto) content.push({ type: "text", text: m.texto });
    for (const c of m.chamadas || []) content.push({ type: "tool_use", id: c.id, name: c.nome, input: c.args });
    return { role: "assistant", content: content.length ? content : m.texto || "" };
  }
  return {
    role: "user",
    content: m.resultados.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: r.conteudo })),
  };
}

// --------------------- OpenAI e compatíveis --------------------------------
async function chamarOpenAI(cfg, { sistema, mensagens, ferramentas, forcarTexto, maxTokens }) {
  const messages = [{ role: "system", content: [sistema.fixo, sistema.variavel].filter(Boolean).join("\n\n") }];
  for (const m of mensagens) messages.push(...paraOpenAI(m));
  const corpo = {
    model: cfg.modelo,
    [cfg.campoLimite]: maxTokens,
    messages,
    tools: ferramentas.map((f) => ({
      type: "function",
      function: { name: f.nome, description: f.descricao, parameters: f.parametros },
    })),
    tool_choice: forcarTexto ? "none" : "auto",
    ...(cfg.esforco && cfg.esforco !== "padrao" ? { reasoning_effort: cfg.esforco } : {}),
  };
  const r = await postar(cfg, { Authorization: `Bearer ${cfg.chave}` }, corpo);
  const msg = (r.choices && r.choices[0] && r.choices[0].message) || {};
  const u = r.usage || {};
  const cache = (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) || u.prompt_cache_hit_tokens || 0;
  return {
    texto: textoOpenAI(msg.content),
    chamadas: (msg.tool_calls || [])
      .filter((t) => t && t.function && t.function.name)
      .map((t, i) => ({ id: t.id || `chamada_${i + 1}`, nome: t.function.name, args: lerArgs(t.function.arguments) })),
    uso: { entrada: Math.max(0, (u.prompt_tokens || 0) - cache), cache, saida: u.completion_tokens || 0 },
  };
}

function paraOpenAI(m) {
  if (m.role === "user") return [{ role: "user", content: m.texto }];
  if (m.role === "assistant") {
    const saida = { role: "assistant", content: m.texto || null };
    if (m.chamadas && m.chamadas.length) {
      saida.tool_calls = m.chamadas.map((c) => ({
        id: c.id,
        type: "function",
        function: { name: c.nome, arguments: JSON.stringify(c.args || {}) },
      }));
    }
    if (saida.content === null && !saida.tool_calls) saida.content = "";
    return [saida];
  }
  return m.resultados.map((r) => ({ role: "tool", tool_call_id: r.id, name: r.nome, content: r.conteudo }));
}

function textoOpenAI(content) {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) return content.map((p) => (typeof p === "string" ? p : p.text || "")).join("").trim();
  return "";
}

function lerArgs(a) {
  if (a && typeof a === "object") return a;
  try {
    const v = JSON.parse(a || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
