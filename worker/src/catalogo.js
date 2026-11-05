// Leitura e busca no catálogo de imóveis (catalogo.json gerado a partir do feed).

const CACHE_MS = 10 * 60 * 1000; // relê o catálogo a cada 10 minutos
let memoria = { quando: 0, url: "", dados: null };

export async function carregarCatalogo(url, agora = Date.now()) {
  if (memoria.dados && memoria.url === url && agora - memoria.quando < CACHE_MS) {
    return memoria.dados;
  }
  try {
    const resp = await fetch(url, { cf: { cacheTtl: 600, cacheEverything: true } });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    const imoveis = (json.imoveis || []).map((i) => ({
      ...i,
      _bairro: normalizar(i.bairro),
      _texto: normalizar([i.titulo, i.tipo, i.bairro, i.endereco, i.descricao, ...(i.caracteristicas || [])].join(" ")),
    }));
    memoria = { quando: agora, url, dados: { gerado_em: json.gerado_em, imoveis } };
  } catch (erro) {
    console.log("catalogo_erro", String(erro));
    if (!memoria.dados) throw erro; // sem cópia anterior não há o que fazer
  }
  return memoria.dados;
}

export function normalizar(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function semelhante(tipoImovel, tipoPedido) {
  const t = normalizar(tipoImovel);
  const p = normalizar(tipoPedido);
  if (!p) return true;
  if (p.startsWith("apart")) return t.startsWith("apart") || t.includes("flat") || t.includes("kitnet") || t.includes("studio");
  if (p.startsWith("cobert")) return t.includes("cobert");
  if (p.startsWith("casa")) return t.includes("casa");
  if (p.startsWith("sala") || p.includes("comerc")) return t.includes("sala") || t.includes("comerc") || t.includes("loja");
  return t.includes(p);
}

export function buscar(imoveis, f = {}) {
  const bairros = [].concat(f.bairro || []).map(normalizar).filter(Boolean);
  const palavras = [].concat(f.palavras_chave || []).map(normalizar).filter(Boolean);
  const limite = Math.min(Math.max(Number(f.limite) || 4, 1), 8);

  let lista = imoveis.filter((i) => {
    if (bairros.length && !bairros.some((b) => i._bairro && (i._bairro.includes(b) || b.includes(i._bairro)))) return false;
    if (f.tipo && !semelhante(i.tipo, f.tipo)) return false;
    if (f.quartos_min && !(i.quartos >= f.quartos_min)) return false;
    if (f.quartos_max && !(i.quartos <= f.quartos_max)) return false;
    if (f.vagas_min && !(i.vagas >= f.vagas_min)) return false;
    if (f.suite && !(i.suites >= 1)) return false;
    if (f.area_min && !(i.area >= f.area_min)) return false;
    if (f.preco_min && !(i.preco >= f.preco_min)) return false;
    if (f.preco_max && !(i.preco <= f.preco_max)) return false;
    if (palavras.length && !palavras.every((p) => i._texto.includes(p))) return false;
    return true;
  });

  const total = lista.length;
  // Com teto de preço, mostra primeiro os mais próximos do teto (o visitante costuma usar o orçamento todo)
  lista.sort((a, b) => (f.preco_max ? (b.preco || 0) - (a.preco || 0) : (a.preco || 0) - (b.preco || 0)));
  return { total, imoveis: lista.slice(0, limite).map(resumo) };
}

export function acharPorCodigo(imoveis, codigo) {
  const c = normalizar(codigo).replace(/^#/, "");
  return imoveis.find((i) => normalizar(i.codigo) === c || normalizar(i.id) === c) || null;
}

export function acharPorUrl(imoveis, url) {
  const m = String(url || "").match(/\/imovel\/(\d+)\//);
  if (!m) return null;
  return imoveis.find((i) => i.id === m[1] || (i.url || "").includes(`/imovel/${m[1]}/`)) || null;
}

export function resumo(i) {
  return {
    codigo: i.codigo,
    tipo: i.tipo,
    bairro: i.bairro,
    preco: i.preco,
    quartos: i.quartos,
    suites: i.suites,
    vagas: i.vagas,
    area: i.area,
    titulo: i.titulo,
  };
}

export function detalhes(i) {
  const { _bairro, _texto, foto, ...resto } = i;
  return resto;
}

export function cartao(i) {
  return {
    codigo: i.codigo,
    titulo: i.titulo || `${i.tipo} em ${i.bairro}`,
    bairro: i.bairro,
    preco: i.preco,
    quartos: i.quartos,
    vagas: i.vagas,
    area: i.area,
    foto: i.foto || "",
    url: i.url,
  };
}

export function resumoDoCatalogo(imoveis) {
  const porBairro = {};
  let min = Infinity;
  let max = 0;
  for (const i of imoveis) {
    porBairro[i.bairro] = (porBairro[i.bairro] || 0) + 1;
    if (i.preco) {
      min = Math.min(min, i.preco);
      max = Math.max(max, i.preco);
    }
  }
  const bairros = Object.entries(porBairro)
    .sort((a, b) => b[1] - a[1])
    .map(([b, n]) => `${b} (${n})`)
    .join(", ");
  const faixa = max ? `de R$ ${Math.round(min).toLocaleString("pt-BR")} a R$ ${Math.round(max).toLocaleString("pt-BR")}` : "não informada";
  return `Catálogo atual: ${imoveis.length} imóveis à venda. Bairros: ${bairros}. Faixa de preço: ${faixa}.`;
}
