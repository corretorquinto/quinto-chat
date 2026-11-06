// Pré-preenchimento das fichas que o widget mostra no chat.
// O envio em si acontece no navegador do visitante, pelos formulários nativos
// do ImobiBrasil (Fale Conosco, formulário do imóvel, WhatsApp Lead), que gravam o lead no CRM.

const TIPOS = ["Apartamento", "Casa", "Casa em condomínio", "Cobertura", "Sala comercial", "Outro"];
const PAGAMENTOS = ["À vista", "Financiamento", "Permuta", "Ainda não sei"];
const PRAZOS_COMPRA = ["Até 3 meses", "De 3 a 6 meses", "Mais de 6 meses", "Só pesquisando"];
const PRAZOS_VENDA = ["Até 3 meses", "De 3 a 6 meses", "Mais de 6 meses", "Não definido"];
const SITUACOES = ["Desocupado", "Ocupado pelo proprietário", "Alugado"];
const DOCUMENTACOES = ["Escritura registrada no RGI", "Inventário em andamento", "Ainda financiado", "Não sei informar"];
const PERMUTA = ["Não", "Sim", "Talvez"];
// Faixas de valor da busca personalizada (o widget usa as mesmas chaves)
export const FAIXAS = [
  ["ate300", "Até R$ 300 mil", 300000],
  ["300a500", "R$ 300 mil a R$ 500 mil", 500000],
  ["500a800", "R$ 500 mil a R$ 800 mil", 800000],
  ["800a1200", "R$ 800 mil a R$ 1,2 milhão", 1200000],
  ["1200a2000", "R$ 1,2 milhão a R$ 2 milhões", 2000000],
  ["acima2000", "Acima de R$ 2 milhões", Infinity],
  ["nao_sei", "Ainda não sei / simular financiamento", null],
];
const INTERESSES = { visita: "agendar uma visita", proposta: "fazer uma proposta", informacoes: "receber mais informações" };

export const OPCOES = { TIPOS, PAGAMENTOS, PRAZOS_COMPRA, PRAZOS_VENDA, SITUACOES, DOCUMENTACOES, PERMUTA };

export function prefillBusca(e = {}) {
  return {
    tipo: escolha(e.tipo, TIPOS),
    bairros: [].concat(e.bairros || []).map(texto).filter(Boolean).join(", ").slice(0, 200),
    quartos_min: inteiro(e.quartos_min, 1, 10),
    suite: e.suite === true,
    vagas_min: inteiro(e.vagas_min, 1, 10),
    area_min: inteiro(e.area_min, 1, 5000),
    preco_max: valorEmReais(e.preco_max),
    faixa: e.valor_indefinido === true ? "nao_sei" : faixaDe(valorEmReais(e.preco_max)),
    pagamento: escolha(e.pagamento, PAGAMENTOS),
    permuta: texto(e.permuta).slice(0, 300),
    prazo: escolha(e.prazo, PRAZOS_COMPRA),
    caracteristicas: texto(e.caracteristicas).slice(0, 400),
  };
}

export function prefillVenda(e = {}) {
  return {
    tipo: escolha(e.tipo, TIPOS),
    bairro: texto(e.bairro).slice(0, 80),
    endereco: texto(e.endereco).slice(0, 150),
    quartos: inteiro(e.quartos, 1, 10),
    vagas: Number.isInteger(e.vagas) && e.vagas >= 0 && e.vagas <= 10 ? e.vagas : null,
    area: inteiro(e.area, 1, 5000),
    valor_pretendido: valorEmReais(e.valor_pretendido),
    situacao: escolha(e.situacao, SITUACOES),
    documentacao: escolha(e.documentacao, DOCUMENTACOES),
    aceita_permuta: escolha(e.aceita_permuta, PERMUTA),
    prazo: escolha(e.prazo, PRAZOS_VENDA),
    observacoes: texto(e.observacoes).slice(0, 400),
  };
}

// Mensagem que vai no formulário da página do imóvel (limite do ImobiBrasil: 800 caracteres)
export function mensagemImovel(imovel, interesse, resumo) {
  const quero = INTERESSES[interesse] || INTERESSES.informacoes;
  const titulo = texto(imovel.titulo || `${imovel.tipo} em ${imovel.bairro}`).replace(/\s*\|\s*Quinto\s*$/i, "");
  const linhas = [`Olá! Tenho interesse no imóvel #${imovel.codigo} (${titulo}) e gostaria de ${quero}.`];
  const r = texto(resumo);
  if (r) linhas.push(r);
  linhas.push("(Enviado pelo assistente do site)");
  let msg = linhas.join("\n");
  if (msg.length > 790) msg = msg.slice(0, 787) + "...";
  return msg;
}

// "800 mil", "R$ 1,2 milhão", "800.000", 800000 -> 800000
export function valorEmReais(v) {
  if (typeof v === "number") return v > 0 && v < 1e9 ? Math.round(v) : null;
  const s = texto(v).toLowerCase().replace(/r\$\s*/g, "");
  if (!s) return null;
  const m = s.match(/(\d+(?:[.,]\d+)*)\s*(mil|k|milh[aã]o|milh[oõ]es|mi|m)?\b/);
  if (!m) return null;
  let n = m[1];
  const mult = !m[2] ? 1 : /^(mil|k)$/.test(m[2]) ? 1e3 : 1e6;
  if (mult === 1) n = n.replace(/[.,](\d{2})$/, "x$1").replace(/[.,]/g, "").replace("x", ".");
  else n = n.replace(/\./g, "").replace(",", ".");
  const valor = Math.round(parseFloat(n) * mult);
  return valor > 0 && valor < 1e9 ? valor : null;
}

function texto(v) {
  return String(v == null ? "" : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim();
}

function inteiro(v, min, max) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function escolha(v, opcoes) {
  const alvo = texto(v).toLowerCase();
  if (!alvo) return "";
  const porTamanho = [...opcoes].sort((a, b) => b.length - a.length);
  return (
    opcoes.find((o) => o.toLowerCase() === alvo) ||
    porTamanho.find((o) => alvo.includes(o.toLowerCase())) ||
    porTamanho.find((o) => o.toLowerCase().startsWith(alvo.slice(0, 4))) ||
    ""
  );
}

// Valor máximo informado -> chave da faixa ("" se não informou)
export function faixaDe(valor) {
  if (!valor) return "";
  const f = FAIXAS.find((x) => x[2] !== null && valor <= x[2]);
  return f ? f[0] : "";
}

// ---------------------------------------------------------------------------
// Complemento das fichas: se o modelo esqueceu de preencher algo que o visitante
// disse com todas as letras (tipo, bairro, quartos), completa a partir do texto dele.
// Só preenche quando não há ambiguidade; nunca sobrescreve o que o modelo mandou.
// ---------------------------------------------------------------------------
const BAIRROS_NITEROI = [
  "Icaraí", "Jardim Icaraí", "Santa Rosa", "Ingá", "São Francisco", "Charitas", "Piratininga", "Camboinhas",
  "Itaipu", "Itacoatiara", "Boa Viagem", "Gragoatá", "São Domingos", "Fonseca", "Vital Brazil", "Pé Pequeno",
  "Badu", "Pendotiba", "Maria Paula", "Largo da Barra", "Cafubá", "Jurujuba", "Engenho do Mato", "Serra Grande",
  "Viradouro", "Cubango", "Barreto", "Santana", "Ponta d'Areia", "Vila Progresso", "Maceió", "Sapê", "Matapaca",
  "Muriqui", "Cachoeira", "Ititioca", "Largo da Batalha", "Engenhoca", "Caramujo", "Baldeador", "Tenente Jardim",
];

function semAcento(t) {
  return String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function tiposCitados(t) {
  const achados = new Set();
  let s = semAcento(t);
  if (/\bcasas? (em|de) condominio\b/.test(s)) {
    achados.add("Casa em condomínio");
    s = s.replace(/\bcasas? (em|de) condominio\b/g, " ");
  }
  if (/\bcoberturas?\b/.test(s)) achados.add("Cobertura");
  if (/\bcasas?\b/.test(s)) achados.add("Casa");
  if (/\b(apartamentos?|aptos?|apes?|apês?)\b/.test(s)) achados.add("Apartamento");
  if (/\b(salas? comerciais?|sala comercial|lojas?)\b/.test(s)) achados.add("Sala comercial");
  return [...achados];
}

function bairrosCitados(t, extras = []) {
  let s = " " + semAcento(t).replace(/[^a-z0-9' ]+/g, " ") + " ";
  const nomes = [...new Set([...BAIRROS_NITEROI, ...extras].filter(Boolean))].sort((a, b) => b.length - a.length);
  const achados = [];
  for (const nome of nomes) {
    const n = " " + semAcento(nome).replace(/[^a-z0-9' ]+/g, " ") + " ";
    if (n.trim().length < 3) continue;
    if (s.includes(n)) {
      achados.push(nome);
      s = s.split(n).join("  "); // "Jardim Icaraí" não conta também como "Icaraí"
    }
  }
  return achados;
}

function quartosCitados(t) {
  const s = semAcento(t);
  const nums = new Set();
  const palavras = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5 };
  for (const m of s.matchAll(/\b(\d|um|uma|dois|duas|tres|quatro|cinco)\s*(quartos?|qts?|dormitorios?)\b/g)) {
    nums.add(palavras[m[1]] || Number(m[1]));
  }
  return [...nums];
}

export function completarFicha(tipoFicha, entrada, textoVisitante, bairrosDoCatalogo = []) {
  const e = { ...entrada };
  const t = String(textoVisitante || "");
  if (!t) return e;
  if (!e.tipo) {
    const tipos = tiposCitados(t);
    if (tipos.length === 1) e.tipo = tipos[0];
  }
  const bairros = bairrosCitados(t, bairrosDoCatalogo);
  const quartos = quartosCitados(t);
  if (tipoFicha === "busca") {
    if (!e.bairros || ![].concat(e.bairros).filter(Boolean).length) {
      if (bairros.length) e.bairros = bairros;
    }
    if (!e.quartos_min && quartos.length === 1) e.quartos_min = quartos[0];
  } else {
    if (!e.bairro && bairros.length === 1) e.bairro = bairros[0];
    if (!e.quartos && quartos.length === 1) e.quartos = quartos[0];
  }
  return e;
}
