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
