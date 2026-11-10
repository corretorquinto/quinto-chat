// Leitura ao vivo da página de um imóvel no site (quintoimoveis.com.br).
// Quando o visitante está na página de um imóvel, o Worker lê essa página na hora: assim o
// agente tem preço, condomínio, IPTU, descrição e características atualizados, inclusive de
// um imóvel cadastrado depois da última atualização do catálogo.
// Para gastar pouco processamento, só o trecho da ficha do imóvel é analisado.

const VALIDADE_MS = 30 * 60 * 1000;
const lidas = new Map(); // url -> { quando, dados }

const ENTIDADES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", sup2: "²", ordm: "º", ordf: "ª", ndash: "–", mdash: "—", rsaquo: "›", laquo: "«", raquo: "»", hellip: "…", deg: "°" };
const ACENTOS = { a: "àáâãä", e: "èéêë", i: "ìíîï", o: "òóôõö", u: "ùúûü", c: "ç", n: "ñ", A: "ÀÁÂÃÄ", E: "ÈÉÊË", I: "ÌÍÎÏ", O: "ÒÓÔÕÖ", U: "ÙÚÛÜ", C: "Ç", N: "Ñ" };
const SUFIXOS = { grave: 0, acute: 1, circ: 2, tilde: 3, uml: 4, cedil: 0 };

export function desfazerEntidades(t) {
  return String(t || "").replace(/&(#x?[0-9a-f]+|[a-z0-9]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    if (ENTIDADES[e] !== undefined) return ENTIDADES[e];
    const ml = e.match(/^([a-zA-Z])(grave|acute|circ|tilde|uml|cedil)$/);
    if (ml && ACENTOS[ml[1]]) return ACENTOS[ml[1]][SUFIXOS[ml[2]]] || m;
    return m;
  });
}

function texto(html) {
  return desfazerEntidades(
    String(html || "")
      .replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>|<\/h\d>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function numero(s) {
  let v = String(s || "").replace(/[^0-9,.]/g, "");
  if (!v) return null;
  if (v.includes(",")) v = v.replace(/\./g, "").replace(",", ".");
  else if (/\.\d{3}(\.|$)/.test(v)) v = v.replace(/\./g, "");
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function inteiro(re, t) {
  const m = t.match(re);
  return m ? parseInt(m[1], 10) : null;
}

// Extrai os dados da página de um imóvel do ImobiBrasil (formato conferido em 10/11/2026)
export function lerPaginaImovel(html) {
  const h = String(html || "");
  const titulo = texto((h.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
  const ini = h.search(/id\s*=\s*["']desc_info["']/i);
  const fim = h.search(/id\s*=\s*["']desc_mapa-localizacao["']/i);
  const ficha = h.slice(ini >= 0 ? ini : 0, fim > ini ? fim : (ini >= 0 ? ini : 0) + 40000);
  const t = texto(ficha);
  const d = {};

  const mt = titulo.match(/^([A-ZÀ-Ý][A-Za-zÀ-ÿ ]{2,40}?)\s+para\s+Venda,\s*(?:em\s+)?([^,/]{0,40}?)\s*(?:\/\s*[A-Z]{2})?\s*,\s*bairro\s+([^,]{2,40})/);
  if (mt) {
    d.tipo = mt[1].trim();
    if (mt[2].trim()) d.cidade = mt[2].trim();
    d.bairro = mt[3].trim();
  }
  const base = titulo + "\n" + t;
  const ref = base.match(/Ref\.?:\s*([A-Za-z]{1,6}\d{1,7})\b/) || base.match(/C[óo]digo:\s*([A-Za-z]{1,6}\d{1,7})\b/);
  if (ref) d.codigo = ref[1].toUpperCase();
  d.quartos = inteiro(/(\d{1,2})\s*dormit[óo]rios?/i, base);
  d.suites = inteiro(/(\d{1,2})\s*su[ií]tes?/i, base);
  d.banheiros = inteiro(/(\d{1,2})\s*banheiros?/i, base);
  d.vagas = inteiro(/(\d{1,2})\s*vagas?/i, base);
  const area = base.match(/[áa]rea\s+[úu]til:?\s*([\d.,]+)\s*m/i);
  if (area) d.area = numero(area[1]);
  const terreno = base.match(/[áa]rea\s+(?:do\s+)?terreno:?\s*([\d.,]+)\s*m/i) || base.match(/terreno\s+([\d.,]+)\s*m/i);
  if (terreno) d.area_terreno = numero(terreno[1]);
  for (const m of t.matchAll(/R\$\s*([\d.]+(?:,\d{2})?)/g)) {
    const v = numero(m[1]);
    if (v && v >= 20000) {
      d.preco = v;
      break;
    }
  }
  const cond = t.match(/Condom[íi]nio:?\s*(?:R\$)?\s*([\d.]+,\d{2})/i);
  if (cond) d.condominio = numero(cond[1]);
  const iptu = t.match(/IPTU:?\s*(?:R\$)?\s*([\d.]+,\d{2})/i);
  if (iptu) d.iptu = numero(iptu[1]);
  const end = t.match(/Endere[çc]o:\s*([^\n|]{3,90}?)(?=\s+(?:Bairro|Cidade|CEP|C[óo]digo|[ÁA]rea|Valor|Condom[íi]nio|IPTU)\b|\s*\n|\s*$)/i);
  if (end && !/^(Bairro|Cidade|C[óo]digo)\b/i.test(end[1].trim())) d.endereco = end[1].trim();
  if (!d.bairro) {
    const b = t.match(/Bairro:\s*([^\n›,]{2,40}?)(?=\s+(?:Cidade|CEP|C[óo]digo|[ÁA]rea)\b|\s*[\n›,]|\s*$)/i);
    if (b) d.bairro = b[1].trim();
  }

  const di = ficha.search(/id\s*=\s*["']desc_descricao["']/i);
  if (di >= 0) {
    let bloco = ficha.slice(di);
    bloco = bloco.slice(bloco.indexOf(">") + 1);
    const corte = bloco.search(/<div[^>]*class\s*=\s*["'][^"']*imovel_cx_caracteristicas/i);
    const desc = texto((corte >= 0 ? bloco.slice(0, corte) : bloco).replace(/<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/gi, " "));
    if (desc.length >= 40) d.descricao = desc.slice(0, 3000);
    const itens = [...bloco.matchAll(/class\s*=\s*["']cxItem["'][^>]*>([\s\S]*?)<\/div>/gi)].map((x) => texto(x[1])).filter((x) => x.length > 1 && x.length < 60);
    if (itens.length) d.caracteristicas = [...new Set(itens)].slice(0, 40);
  }
  const foto = h.match(/<meta[^>]*property\s*=\s*["']og:image["'][^>]*content\s*=\s*["']([^"']+)/i) || h.match(/<meta[^>]*content\s*=\s*["']([^"']+)["'][^>]*property\s*=\s*["']og:image/i);
  if (foto) d.foto = foto[1];
  for (const k of Object.keys(d)) if (d[k] === null || d[k] === undefined || d[k] === "") delete d[k];
  return d;
}

// Tipo e cidade pelo endereço da página, para quando o título do anúncio não traz
// ("/imovel/4396807/apartamento-venda-niteroi-rj-icarai" -> Apartamento, Niterói)
const CIDADES = { niteroi: "Niterói", marica: "Maricá", "sao-goncalo": "São Gonçalo", itaborai: "Itaboraí", "rio-de-janeiro": "Rio de Janeiro" };
export function doEndereco(url) {
  const slug = (String(url).match(/\/imovel\/\d+\/-?([a-z0-9\-]+)/i) || [])[1] || "";
  const d = {};
  const t = slug.match(/^(apartamento|casa-duplex|casa-em-condominio|casa|cobertura|sala-comercial|loja|terreno|kitnet|flat|studio)-venda\b/);
  if (t) d.tipo = t[1].replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
  const c = slug.match(/-(niteroi|marica|sao-goncalo|itaborai|rio-de-janeiro)-rj\b/);
  if (c) d.cidade = CIDADES[c[1]];
  return d;
}

// Só lê páginas de imóvel do próprio site
export function urlDeImovelDoSite(url, dominio = "quintoimoveis.com.br") {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (!(host === dominio || host.endsWith("." + dominio))) return null;
    const m = u.pathname.match(/^\/imovel\/(\d{4,})\/[a-z0-9\-]+/i);
    return m ? { id: m[1], url: `https://www.${dominio}${m[0]}` } : null;
  } catch {
    return null;
  }
}

// Lê a página (com memória de 30 minutos). Devolve null se não der: o agente segue com o catálogo.
export async function lerImovelAoVivo(url, dominio, agora = Date.now()) {
  const alvo = urlDeImovelDoSite(url, dominio);
  if (!alvo) return null;
  const guardado = lidas.get(alvo.url);
  if (guardado && agora - guardado.quando < VALIDADE_MS) return guardado.dados;
  try {
    const resp = await fetch(alvo.url, {
      headers: { "User-Agent": "QuintoChat/2.1 (+https://www.quintoimoveis.com.br)" },
      cf: { cacheTtl: 600, cacheEverything: true },
      signal: AbortSignal.timeout(4000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const bytes = await resp.arrayBuffer();
    const tipo = resp.headers.get("content-type") || "";
    const cs = (tipo.match(/charset=([\w-]+)/i) || [])[1] || (/iso-8859-1|latin1|windows-1252/i.test(tipo) ? "latin1" : "utf-8");
    let html;
    try {
      html = new TextDecoder(cs).decode(bytes);
    } catch {
      html = new TextDecoder("utf-8").decode(bytes);
    }
    const dados = { ...doEndereco(alvo.url), ...lerPaginaImovel(html), id: alvo.id, url: alvo.url };
    if (!dados.preco && !dados.codigo) throw new Error("página sem dados de imóvel");
    lidas.set(alvo.url, { quando: agora, dados });
    if (lidas.size > 300) lidas.delete(lidas.keys().next().value);
    return dados;
  } catch (e) {
    console.log(JSON.stringify({ evento: "imovel_ao_vivo_falhou", url: alvo.url, erro: String(e && e.message || e).slice(0, 120) }));
    return null;
  }
}

// Junta o que veio do catálogo com o que foi lido agora (a página manda nos valores que mudam)
export function juntarComAoVivo(doCatalogo, aoVivo) {
  if (!aoVivo) return doCatalogo || null;
  const base = doCatalogo ? { ...doCatalogo } : {
    id: aoVivo.id, codigo: aoVivo.codigo || aoVivo.id, tipo: aoVivo.tipo || "Imóvel", finalidade: "Venda",
    bairro: aoVivo.bairro || "", cidade: aoVivo.cidade || "Niterói", url: aoVivo.url, caracteristicas: [],
    titulo: `${aoVivo.tipo || "Imóvel"}${aoVivo.bairro ? " em " + aoVivo.bairro : ""}`,
  };
  for (const k of ["preco", "condominio", "iptu", "descricao", "endereco", "quartos", "suites", "banheiros", "vagas", "area", "area_terreno", "foto"]) {
    if (aoVivo[k] !== undefined) base[k] = aoVivo[k];
  }
  if (aoVivo.caracteristicas && aoVivo.caracteristicas.length) {
    base.caracteristicas = [...new Set([...(base.caracteristicas || []), ...aoVivo.caracteristicas])].slice(0, 50);
  }
  base.lido_agora = true;
  return base;
}
