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
      _cidade: normalizar(i.cidade),
      _texto: normalizar([i.titulo, i.tipo, i.bairro, i.endereco, i.descricao, ...(i.caracteristicas || [])].join(" ")),
    }));
    // páginas e artigos do site (resumos), para o agente responder sobre o conteúdo do site
    const paginas = (json.paginas || []).map((p) => ({ ...p, _titulo: normalizar(p.titulo), _texto: normalizar(p.resumo) }));
    const sairam = (json.sairam || []).map((i) => ({ ...i, _bairro: normalizar(i.bairro), _cidade: normalizar(i.cidade) }));
    memoria = {
      quando: agora,
      url,
      dados: { gerado_em: json.gerado_em, imoveis, paginas, sairam, historico_desde: json.historico_desde || null, fontes: json.fontes || null },
    };
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
  const cidade = normalizar(f.cidade);
  const rua = nomeDaRua(f.rua);

  let lista = imoveis.filter((i) => {
    // o filtro de bairro também aceita a cidade (ex.: ['Maricá'])
    if (bairros.length && !bairros.some((b) => (i._bairro && (i._bairro.includes(b) || b.includes(i._bairro))) || (i._cidade && i._cidade === b))) return false;
    if (cidade && i._cidade !== cidade) return false;
    if (rua && !naRua(i, rua)) return false;
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
  // ordenar: "recentes" (cadastrados por último), "menor_preco" ou "maior_preco".
  // Sem ordem pedida: com teto de preço, os mais próximos do teto primeiro; senão, do menor para o maior preço.
  const ordem = normalizar(f.ordenar);
  if (ordem === "recentes") lista.sort(maisRecente);
  else if (ordem === "maior_preco") lista.sort((a, b) => (b.preco || 0) - (a.preco || 0));
  else if (ordem === "menor_preco") lista.sort((a, b) => (a.preco || 0) - (b.preco || 0));
  else lista.sort((a, b) => (f.preco_max ? (b.preco || 0) - (a.preco || 0) : (a.preco || 0) - (b.preco || 0)));
  return { total, imoveis: lista.slice(0, limite).map(resumo) };
}

// O número do imóvel no site cresce a cada cadastro: quanto maior, mais recente
export function ordemDeCadastro(i) {
  return Number(String(i.id || "").replace(/\D/g, "")) || 0;
}
// Mais recentes primeiro: pela data em que entrou no catálogo; sem data, pelo número do site
export function maisRecente(a, b) {
  if (a.desde && b.desde && a.desde !== b.desde) return a.desde < b.desde ? 1 : -1;
  if (a.desde && !b.desde) return -1;
  if (b.desde && !a.desde) return 1;
  return ordemDeCadastro(b) - ordemDeCadastro(a);
}

// "Rua Otávio Carneiro, 123" ou "otavio carneiro" -> "otavio carneiro" (sem o tipo de logradouro)
export function nomeDaRua(t) {
  const s = normalizar(t).split(/[,\-–]/)[0].replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  return s.replace(/^(rua|r|avenida|av|estrada|estr|travessa|tv|alameda|al|praca|largo|lgo|via|rodovia)\s+/, "").trim();
}
// O imóvel fica na rua? Vale o endereço; se ele estiver vazio, a rua citada no título ou na descrição
function naRua(i, rua) {
  if (rua.length < 4) return false;
  const end = nomeDaRua(i.endereco);
  if (end) return end === rua || end.includes(rua) || (rua.includes(end) && end.length >= 6);
  return (" " + (i._texto || "") + " ").replace(/[^a-z0-9 ]+/g, " ").includes(" " + rua + " ");
}

// Imóveis que saíram do site (vendidos ou retirados), com a data em que saíram
export function consultarSaidas(sairam, f = {}) {
  const cidade = normalizar(f.cidade);
  const bairros = [].concat(f.bairro || []).map(normalizar).filter(Boolean);
  const rua = nomeDaRua(f.rua);
  const lista = (sairam || []).filter((i) => {
    if (cidade && i._cidade !== cidade) return false;
    if (bairros.length && !bairros.some((b) => i._bairro && (i._bairro.includes(b) || b.includes(i._bairro)))) return false;
    if (f.tipo && !semelhante(i.tipo, f.tipo)) return false;
    if (rua && !(nomeDaRua(i.endereco) || "").includes(rua)) return false;
    return true;
  });
  lista.sort((a, b) => (a.saiu_em < b.saiu_em ? 1 : a.saiu_em > b.saiu_em ? -1 : 0));
  return {
    total: lista.length,
    imoveis: lista.slice(0, 10).map(({ _bairro, _cidade, id, ...r }) => r),
  };
}

const VAZIAS = new Set("a o e de da do das dos em no na nos nas um uma para por com que como qual quais sobre tem ter the".split(" "));

// Procura nas páginas e artigos do site os que tratam do assunto pedido
export function consultarSite(paginas, termos, limite = 4) {
  const palavras = [...new Set(normalizar(termos).split(/[^a-z0-9]+/).filter((p) => p.length >= 3 && !VAZIAS.has(p)))];
  if (!palavras.length) return [];
  return (paginas || [])
    .map((p) => {
      let pontos = 0;
      for (const w of palavras) {
        if (p._titulo.includes(w)) pontos += 3;
        if (p._texto.includes(w)) pontos += 1;
      }
      return { p, pontos };
    })
    .filter((x) => x.pontos > 0)
    .sort((a, b) => b.pontos - a.pontos)
    .slice(0, limite)
    .map(({ p }) => ({ titulo: p.titulo, tipo: p.tipo, url: p.url, resumo: String(p.resumo || "").slice(0, 700) }));
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
    ...(i.cidade && i.cidade !== "Niterói" ? { cidade: i.cidade } : {}),
    ...(i.endereco ? { endereco: i.endereco } : {}),
    preco: i.preco,
    quartos: i.quartos,
    suites: i.suites,
    vagas: i.vagas,
    area: i.area,
    titulo: limparTitulo(i.titulo),
    ...(i.desde ? { no_site_desde: i.desde } : {}),
  };
}

export function detalhes(i) {
  const { _bairro, _cidade, _texto, foto, ...resto } = i;
  return resto;
}

export function cartao(i) {
  return {
    codigo: i.codigo,
    titulo: limparTitulo(i.titulo) || `${i.tipo} em ${i.bairro}`,
    bairro: i.bairro,
    preco: i.preco,
    quartos: i.quartos,
    vagas: i.vagas,
    area: i.area,
    foto: i.foto || "",
    url: i.url,
  };
}

export function resumoDoCatalogo(imoveis, extra = {}) {
  const porBairro = {};
  const porCidade = {};
  let min = Infinity;
  let max = 0;
  for (const i of imoveis) {
    porBairro[i.bairro] = (porBairro[i.bairro] || 0) + 1;
    if (i.cidade) porCidade[i.cidade] = (porCidade[i.cidade] || 0) + 1;
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
  const cidades = Object.entries(porCidade)
    .sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `${c} (${n})`)
    .join(", ");
  const porTipo = {};
  for (const i of imoveis) porTipo[i.tipo] = (porTipo[i.tipo] || 0) + 1;
  const tipos = Object.entries(porTipo)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${t} (${n})`)
    .join(", ");
  const recentes = [...imoveis]
    .sort(maisRecente)
    .slice(0, 5)
    .map((i) => `#${i.codigo} (${i.tipo}, ${i.bairro}${i.cidade && i.cidade !== "Niterói" ? ", " + i.cidade : ""}${i.desde ? ", desde " + i.desde.split("-").reverse().join("/") : ""})`)
    .join("; ");
  return `Catálogo atual: ${imoveis.length} imóveis à venda (é tudo o que está à venda no site agora).${cidades ? ` Cidades: ${cidades}.` : ""} Bairros: ${bairros}. Tipos: ${tipos}. Faixa de preço: ${faixa}.${recentes ? ` Cadastrados mais recentemente: ${recentes}.` : ""}${
    extra.historico_desde ? ` O registro de entradas e saídas de imóveis começou em ${extra.historico_desde.split("-").reverse().join("/")}.` : ""
  }`;
}

// Títulos do ImobiBrasil às vezes terminam com " | Quinto" (nome do site): o cartão não precisa disso
export function limparTitulo(t) {
  return String(t || "").replace(/\s*[|–—-]\s*Quinto(\s+Im[óo]veis)?\s*$/i, "").trim();
}
