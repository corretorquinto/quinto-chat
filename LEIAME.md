# Quinto Chat — agente de atendimento do quintoimoveis.com.br

Assistente virtual que conversa com o visitante, busca imóveis reais do catálogo e leva cada contato até o seu **CRM do ImobiBrasil**, usando os formulários nativos do próprio site.

```
Visitante ──> chat no site ──> Worker (Cloudflare) ──> API de IA (Anthropic, OpenAI, DeepSeek, Gemini ou outra)
                  │                  └── catalogo.json (GitHub Pages) <── feed XML do ImobiBrasil (a cada 3 h)
                  │
                  └── formulários nativos do ImobiBrasil ──> CRM (Leads) + e-mail para você
                        • Fale Conosco ............ busca personalizada e captação (venda)
                        • "Fale agora conosco" .... interesse num imóvel (visita, proposta, dúvida)
                        • WhatsApp Lead ........... contato antes de abrir o WhatsApp
```

| Pasta | O que é |
|---|---|
| `catalogo/gerar_catalogo.py` | Lê o feed XML do ImobiBrasil, completa com a listagem do próprio site e gera o `catalogo.json` (imóveis + resumo das páginas e artigos) |
| `.github/workflows/catalogo.yml` | Roda o gerador a cada 3 horas e publica o catálogo |
| `worker/` | Backend: guarda a chave da API e executa o agente |
| `worker/src/prompt.js` | **As regras de atendimento do agente** |
| `worker/quinto-chat-worker.js` | Backend em arquivo único, para colar no painel da Cloudflare |
| `worker/src/aovivo.js` | Leitura ao vivo da página do imóvel em que o visitante está |
| `worker/src/provedores.js` | Conexão com os provedores de IA (Anthropic, OpenAI e compatíveis) |
| `widget/quinto-chat.js` | O chat que aparece no site (fichas e entrega pelos formulários nativos) |
| `widget/demo.html` | Página de teste (simulada ou com o agente real) |
| `gtm/whatsapp-inteligente-v3.html` | **Nova versão da sua tag de WhatsApp no GTM** |
| `testes/` | Testes automáticos e réplicas dos formulários do ImobiBrasil |

---

## O que o agente faz

| Visitante | O que acontece | Onde cai no CRM |
|---|---|---|
| Quer **comprar** e achou algo | Busca no catálogo; mostra uma frase curta e os cartões com foto, preço e link (sem repetir a lista em texto) | — |
| Quer **visitar, propor ou tirar dúvida** sobre um imóvel | Ficha no chat → preenche o "Fale agora conosco" da página do imóvel | Leads, origem **Informações do Imóvel**, ligado ao imóvel |
| Quer comprar e **não achou** | Ficha de **busca personalizada** (inclui imóvel para permuta) → preenche o Fale Conosco | Leads, origem **Fale Conosco** |
| Quer **vender** | Ficha de **captação** (inclui "Aceita permuta?") → preenche o Fale Conosco | Leads, origem **Fale Conosco** |
| Prefere **WhatsApp** | Pede nome e telefone na hora → botão "Enviar mensagem pelo WhatsApp" → registra no WhatsApp Lead → abre o WhatsApp com o resumo (no celular, o aplicativo; no computador, o WhatsApp Web) | Leads, origem **WhatsApp Lead** |

Na busca personalizada, **quanto a pessoa pretende investir também é obrigatório**, escolhido por faixa (até R$ 300 mil, R$ 300–500 mil, R$ 500–800 mil, R$ 800 mil–1,2 milhão, R$ 1,2–2 milhões, acima de R$ 2 milhões, ou "Ainda não sei / simular financiamento", que mostra o link da calculadora). Se a pessoa já falou um valor na conversa, a faixa vem marcada.

O visitante também pode **falar em vez de digitar**: o botão de microfone ao lado do campo de mensagem usa o reconhecimento de voz do próprio navegador (sem custo de API). A fala vira texto no campo e a pessoa confere antes de enviar. Onde o navegador não tem esse recurso, o botão não aparece.

Nas fichas do chat, **nome, telefone e e-mail são obrigatórios**: o chat não deixa seguir sem eles, e o formulário nativo também exige. O chat leva a pessoa ao formulário do site já preenchido; ela **só digita o código de 4 números** (a proteção anti-robô do ImobiBrasil, que o chat não contorna) e toca em Enviar. Você recebe o e-mail de aviso do ImobiBrasil como sempre.

Se o ImobiBrasil mudar esses formulários um dia, o chat não trava: avisa a pessoa e oferece mandar tudo pelo WhatsApp.

O que o agente **não** faz, por regra: inventar dado de imóvel, negociar preço, avaliar imóvel, dar parecer jurídico ou de crédito, pedir CPF ou documentos, pedir dados pessoais na conversa (só na ficha), prometer prazo ou garantir que o imóvel será encontrado, fingir ser você. Também avisa que você não trabalha com planta nem aluguel e usa "Rua Ator Paulo Gustavo" em vez do nome antigo.

---

## Instalação

### 1. Conferir o feed (no seu notebook)

Com a mesma URL do feed que o seu `parser_feed.py` usa:

```
python catalogo\gerar_catalogo.py --feed "URL_DO_FEED" --inspecionar
```

A saída mostra de qual tag do feed saiu cada campo. Se algum campo importante aparecer como **(NÃO ENCONTRADO)**, acrescente o nome certo da tag na lista `SINONIMOS`, no topo do arquivo. Confira principalmente `codigo` (QI1626), `id` (o número da URL, 4383031), `preco`, `bairro` e `url`.

### 2. GitHub: repositório e atualização automática

1. Crie o repositório **público** `quinto-chat` na conta `corretorquinto` e envie todos os arquivos desta pasta (menos `worker/node_modules`).
2. **Settings → Pages**: Source = *Deploy from a branch*, branch `main`, pasta `/ (root)`.
3. **Settings → Secrets and variables → Actions → New repository secret**: nome `FEED_URL`, valor = URL do feed.
4. **Actions → Atualizar catálogo do chat → Run workflow**.
5. Confira: `https://corretorquinto.github.io/quinto-chat/catalogo/catalogo.json`

O catálogo se atualiza sozinho a cada 3 horas. Se o feed vier vazio ou quebrado, o catálogo anterior continua no ar.

### 3. Escolher o provedor de IA e criar a chave

O agente funciona com qualquer provedor. A escolha fica em `worker/wrangler.toml`, no mesmo padrão do `.env` do geocodificador:

```toml
PROVEDOR_ATIVO = "ANTHROPIC"      # ANTHROPIC, OPENAI, DEEPSEEK, GEMINI, GROQ, MISTRAL, XAI, OPENROUTER...
PROVEDOR_RESERVA = ""             # opcional: atende se o ativo falhar
ANTHROPIC_MODELO = "claude-haiku-5-5"
OPENAI_MODELO = "gpt-6-luna"
DEEPSEEK_MODELO = "deepseek-flash"
GEMINI_MODELO = "gemini-2.5-flash-lite"
```

Crie a chave no site do provedor escolhido e defina um **limite de gasto mensal** lá:

| Provedor | Onde criar a chave | Nome do secret |
|---|---|---|
| Anthropic (Claude) | platform.claude.com | `ANTHROPIC_API_KEY` |
| OpenAI (GPT) | platform.openai.com | `OPENAI_API_KEY` |
| DeepSeek | platform.deepseek.com | `DEEPSEEK_API_KEY` |
| Google (Gemini) | aistudio.google.com | `GEMINI_API_KEY` |

**Trocar de provedor depois** (por preço, promoção ou qualidade):
1. Cadastre a chave do novo provedor uma vez: `npx wrangler secret put OPENAI_API_KEY`
2. Mude `PROVEDOR_ATIVO` (e, se quiser, o modelo) no `wrangler.toml`
3. `npx wrangler deploy`

Nenhuma linha de código muda. Provedor que não está na lista também funciona, desde que tenha API "compatível com OpenAI" (a maioria tem): defina `NOVO_FORMATO = "openai"`, `NOVO_API_URL`, `NOVO_MODELO` e o secret `NOVO_API_KEY`, e use `PROVEDOR_ATIVO = "NOVO"`.

Recomendado: deixe um **provedor de reserva** com chave cadastrada (ex.: ativo ANTHROPIC, reserva OPENAI). Se um sair do ar ou o crédito acabar, o outro atende sem o visitante perceber.

O endereço `/saude` do Worker mostra qual provedor e modelo estão em uso e se falta alguma configuração (nunca mostra a chave).

### 4. Cloudflare: publicar o backend

Conta gratuita no Cloudflare. No terminal, dentro da pasta `worker`:

```
npm install
npx wrangler login
npx wrangler secret put ANTHROPIC_API_KEY     (ou a chave do provedor escolhido)
npx wrangler deploy
```

O `secret put` pede a chave e a guarda criptografada no Cloudflare. O `deploy` mostra o endereço do Worker (`https://quinto-chat.SEU-USUARIO.workers.dev`).

Teste: `https://quinto-chat.SEU-USUARIO.workers.dev/saude` deve mostrar `"ok":true`, o número de imóveis e o provedor com `"pronto":true`.

#### 4b. Alternativa sem terminal: pelo painel da Cloudflare

1. **Workers & Pages → Create → Create Worker**, nome `quinto-chat` → **Deploy**.
2. **Edit code**: apague tudo, cole o conteúdo de `worker/quinto-chat-worker.js` (arquivo único, já com tudo) → **Deploy**.
3. **Settings → Variables and Secrets → Add**: tipo **Secret**, nome `OPENAI_API_KEY` (ou a chave do provedor escolhido), valor = a chave → **Deploy**.

A configuração padrão (sites permitidos, catálogo, WhatsApp, provedor OpenAI e modelos) já está dentro do arquivo, na constante `PADROES`. Para mudar algo sem editar o código, crie uma variável de texto com o mesmo nome no painel (ex.: `PROVEDOR_ATIVO` = `ANTHROPIC`); ela substitui o padrão.

Se editar algo em `worker/src`, gere o arquivo único de novo com:
`npx esbuild worker/src/index.js --bundle --format=esm --charset=utf8 --outfile=worker/quinto-chat-worker.js`

### 5. Instalar o chat no site (ImobiBrasil)

No campo de **scripts do cabeçalho**, acrescente (troque o endereço do Worker):

```html
<script src="https://corretorquinto.github.io/quinto-chat/widget/quinto-chat.js" charset="utf-8" data-api="https://quinto-chat.SEU-USUARIO.workers.dev" defer></script>
```

A linha não tem barra invertida, então o ImobiBrasil não a corrompe. O `charset="utf-8"` garante os acentos, já que o site é ISO-8859-1. Por estar no cabeçalho, o chat aparece em todas as páginas, inclusive `/cat/`. O botão fica no canto inferior **direito**, porque o botão verde do WhatsApp do ImobiBrasil fica no esquerdo.

### 6. Trocar a tag do WhatsApp no GTM (v2.2 → v3)

1. No GTM, abra a tag **WhatsApp Inteligente v2.2** e **pause-a** (não apague ainda).
2. Crie uma tag nova do tipo **HTML personalizado**, chamada `WhatsApp Inteligente v3`. Cole todo o conteúdo de `gtm/whatsapp-inteligente-v3.html` e use o **mesmo acionador da v2.2**.
3. Clique em **Visualizar** (modo de prévia) e teste numa página de imóvel: o botão verde deve abrir a janelinha que pede nome e telefone; ao enviar, o WhatsApp abre com a mensagem personalizada e o preço certo.
4. **Envie** (publique). Depois de alguns dias funcionando, apague a v2.2.

**Por que trocar** (tudo verificado no seu site em 04/11/2026):

| Problema da v2.2 | Efeito | Na v3 |
|---|---|---|
| Interceptava o botão verde do WhatsApp Lead | A janelinha de nome e telefone nunca aparecia: **o último contato de WhatsApp no CRM é de 08/02/2026** | A janelinha volta; o contato vai para o CRM e o WhatsApp abre com a mensagem personalizada |
| Lia o preço do bloco "BuyAction" que vem no HTML do site, com o valor ×100 | A mensagem dizia **R$ 40.000.000** num imóvel de R$ 400.000 (o mesmo erro nos 4 imóveis testados) | Lê o preço do seu JSON-LD v15 e ignora o preço do BuyAction |
| Desviava o botão "Compartilhar no WhatsApp" | Quem queria mandar o imóvel para alguém abria conversa com você | Compartilhar volta ao normal |
| "Vi **o** casa", "Vi **o** cobertura" | Erro de concordância | "Vi **a** casa", "Vi **a** cobertura" |
| Bairro tirado do endereço da página | "imóveis em Apartamentos a venda em icarai niteroirj" | "imóveis em Icaraí" |

O evento `whatsapp_click` do dataLayer continua igual, com um parâmetro a mais: `whatsapp_origem` (`link_direto` ou `whatsapp_lead`).

### 7. Testar antes de divulgar

O endereço `https://corretorquinto.github.io/quinto-chat/widget/demo.html?api=https://quinto-chat.SEU-USUARIO.workers.dev` conversa com o agente de verdade. As fichas só são enviadas a partir do seu site, onde estão os formulários do ImobiBrasil. Sem o `?api=`, a página roda em modo demonstração.

---

## Balões de convite

O chat acompanha o visitante: em **toda página nova** aparece um balão ao lado do botão, com uma mensagem que combina com a página (o painel nunca abre sozinho):

| Página | Mensagem |
|---|---|
| Imóvel: ao chegar na descrição **ou** após o tempo, o que vier primeiro | "Gostou deste imóvel? Tiro suas dúvidas e agendo sua visita." |
| A partir do 3º imóvel visto na visita (uma vez) | "Ainda não achou o ideal? Me diga o que procura que o corretor Antônio Quinto busca no mercado para você." |
| Lista e busca de imóveis (/imovel/?..., /buscar, /cat/) | "Não achou o que procura? O corretor Antônio Quinto busca no mercado para você." |
| Venda seu Imóvel (/seu-imovel) | "Pensando em vender seu imóvel? O corretor Antônio Quinto cuida de tudo para você." |
| Financiamento, Calculadora e Correspondente | "Dúvidas sobre financiamento? O corretor Antônio Quinto tem parceria com correspondentes bancários credenciados." |
| Contato | "Prefere falar agora? Respondo na hora e levo seu contato ao corretor Antônio Quinto." |
| Corretor (/sobre) | "Quer conhecer o trabalho do corretor Antônio Quinto? Posso te ajudar a encontrar seu imóvel." |
| Página de bairro (/bairro/...) | "Está pesquisando sobre Santa Rosa? Temos 5 imóveis à venda no bairro. Quer ver?" (o bairro do título da página) |
| Lista do blog (/noticias) | "Gostou do nosso blog? Posso te ajudar a encontrar um imóvel." |
| Notícia que fala de uma rua onde há imóvel à venda | "Temos 2 imóveis à venda na Rua Otávio Carneiro, em Icaraí. Quer ver?" |
| Notícia que fala de um bairro | "Está pesquisando sobre Santa Rosa? Temos 5 imóveis à venda no bairro. Quer ver?" |
| Outra notícia | "Gostou do artigo? Posso te ajudar a encontrar um imóvel pronto." |
| Mouse indo fechar a aba (só computador) | "Antes de ir: quer que eu te avise de imóveis parecidos?" |
| Demais páginas | "Procurando um imóvel? Posso ajudar." |

Nas notícias, o chat lê o texto (sem cabeçalho, menu e rodapé) e cruza com o catálogo: a rua mais citada que tenha imóvel à venda; se não houver, o bairro mais citado.

Regras: o balão fica na tela até a pessoa clicar ou fechar no X. Fechou no X: some naquela página e volta na próxima página que ela abrir, ou depois de 3 minutos se ela continuar na mesma (`data-balao-volta-minutos`). Com o aviso de cookies na tela, o balão aparece acima dele (não espera o aviso sumir). Nenhum balão com o chat aberto, nem depois que a pessoa enviou um formulário ou chamou no WhatsApp. Ao clicar, o chat abre já no assunto do balão, com as sugestões certas (no meio de uma conversa, sem se apresentar de novo).

## Conversa longa e limites

O atendimento ideal leva de 3 a 6 mensagens até o visitante deixar o contato (2 a 4 minutos). O custo depende do número de mensagens, não do tempo no site.

| Quando | O que acontece |
|---|---|
| 6ª e 11ª mensagem, sem contato ainda | O agente responde a dúvida e, na mesma resposta, oferece que o corretor Antônio Quinto continue o atendimento, já com a ficha certa ou o WhatsApp preenchidos |
| Depois da 15ª mensagem | O chat para de responder naquela visita e mostra a ficha "Falar com o corretor" com o resumo do que a pessoa perguntou (vai para o Fale Conosco, ou para o formulário do imóvel se ela estiver na página de um imóvel), com opção de WhatsApp |
| Mais de 20 mensagens em 10 minutos ou 40 no dia, da mesma conexão | O Worker recusa e indica o WhatsApp (proteção contra robôs; aproximada, por servidor do Cloudflare) |

Os números ficam em `LIMITE_CONVERSA` e `EMPURRAO_EM` (`worker/src/index.js`), `LIMITE` e `LIMITE_DIA` (mesmo arquivo) e `LIMITE_CONVERSA` em `widget/quinto-chat.js`.

## Medição no GA4 (via GTM)

O chat envia ao `dataLayer` o evento `quinto_chat`, com o parâmetro `quinto_chat_acao`:

| Ação | Quando |
|---|---|
| `abrir` / `mensagem` | Abriu o chat / mandou mensagem |
| `imovel` | Clicou num cartão de imóvel (com `quinto_chat_codigo`) |
| `ficha_aberta` | O agente mostrou uma ficha (`quinto_chat_tipo`: ficha_busca, ficha_venda, contato_imovel) |
| `ficha_preenchida` | Preencheu a ficha e foi para o formulário do site |
| `lead_enviado` | **Enviou o formulário do site.** Este é o lead (`quinto_chat_origem`: fale_conosco ou informacoes_imovel) |
| `whatsapp` | Abriu o WhatsApp pelo chat (`quinto_chat_lead`: "sim" se o contato foi registrado) |
| `formulario_indisponivel` | O formulário do site não carregou e o chat ofereceu o WhatsApp |
| `limite_conversa` | A conversa chegou a 15 mensagens e foi entregue ao corretor |
| `microfone` | Usou o microfone para falar em vez de digitar |
| `calculadora` | Clicou em "Simule seu financiamento" na ficha de busca |
| `balao_exibido` / `balao_clicado` / `balao_fechado` | Balão de convite mostrado, clicado ou fechado no X (`quinto_chat_balao`: imovel, tres_imoveis, lista, artigo_rua, artigo_bairro, artigo, saida, geral) |

No GTM: acionador **Evento personalizado** `quinto_chat` + tag **Evento do GA4** com os parâmetros acima. Marque `lead_enviado` e `whatsapp` como eventos-chave.

---

## Ajustes do dia a dia

| Quero mudar | Onde |
|---|---|
| Regras e tom do agente | `worker/src/prompt.js`, depois `npx wrangler deploy` |
| Provedor e modelo de IA | `PROVEDOR_ATIVO` e `{PROVEDOR}_MODELO` em `worker/wrangler.toml`, depois `npx wrangler deploy` |
| Campos e textos das fichas | `FICHAS` em `widget/quinto-chat.js` |
| Sugestões iniciais do chat | `mostrarSugestoes()` em `widget/quinto-chat.js` |
| Textos dos balões de convite | `montarBalao()` em `widget/quinto-chat.js` |
| Tempo até o balão aparecer | atributo `data-balao-segundos` na linha do script (padrão 20; no site está 5) |
| Tempo para o balão voltar depois de fechado | atributo `data-balao-volta-minutos` (padrão 3) |
| Cor do chat | atributo `data-cor` na linha do script (padrão #E40951, o rosa do logo) |
| Mensagens do WhatsApp do site | `mensagem()` em `gtm/whatsapp-inteligente-v3.html` |
| Limite de mensagens por visitante | `LIMITE` em `worker/src/index.js` (20 a cada 10 min) |
| Endereço da calculadora de financiamento | variável de texto `CALCULADORA_URL` no painel da Cloudflare (Worker → Settings → Variables and Secrets). Sem ela, vale `/calculadora-financiamento` |
| Faixas de valor da busca | `FAIXAS` em `worker/src/fichas.js` **e** em `widget/quinto-chat.js` (as duas listas precisam ser iguais) |
| Raciocínio do modelo da OpenAI | variável `OPENAI_ESFORCO` (padrão `none`, exigido pelo GPT-6 para usar as ferramentas no chat) |

## Custos

- **GitHub Pages e Actions:** gratuitos para repositório público.
- **Cloudflare Workers:** o plano gratuito cobre com folga.
- **API de IA:** único custo variável. O padrão é o `claude-haiku-5-5`; GPT-6 Luna e Gemini 2.5 Flash-Lite custam praticamente o mesmo (cerca de US$ 4 a 5 por mil conversas, nov/2026). As instruções fixas vêm primeiro em toda chamada, para aproveitar o cache de prompt de qualquer provedor.
- **Acompanhar o consumo:** cada atendimento registra no log do Cloudflare (Workers → quinto-chat → Logs) o provedor, o modelo e os tokens gastos, sem o conteúdo da conversa. Dá para comparar provedores com números reais.

## Privacidade

- O Worker **não grava** conversas nem dados pessoais: registra só quais ferramentas foram usadas.
- Nome, telefone e e-mail só são digitados nas fichas e seguem pelos formulários do próprio site, como qualquer contato do ImobiBrasil.
- A conversa fica no navegador do visitante só enquanto a aba está aberta.
- As mensagens da conversa passam pela API do provedor de IA escolhido para gerar as respostas. Antes de trocar de provedor, confira na política dele onde os dados são processados (LGPD).

## Limitações conhecidas

- **Código anti-robô:** a pessoa precisa digitar o código de 4 números do formulário do site. Isso é proposital: é a proteção do ImobiBrasil.
- **Defasagem do catálogo:** um imóvel vendido pode aparecer por até ~3 horas. Para forçar a atualização, use *Run workflow* no GitHub.
- **Mudanças no ImobiBrasil:** se os formulários nativos mudarem de nome, o chat cai no plano B (WhatsApp com tudo preenchido) e o evento `formulario_indisponivel` aparece no GA4. É o sinal para ajustar.

## Testes

- `python testes/test_catalogo.py`: 10 testes do gerador do catálogo (leitura do site, sem rede).
- `cd worker && npm run teste`: 45 testes do backend com a API simulada.
- `node testes/servidor-e2e.mjs` e, em outro terminal, `python testes/e2e.py`: 49 verificações de ponta a ponta no Chrome, com réplicas exatas dos formulários do ImobiBrasil (mesmos campos, validações e codificação ISO-8859-1). Cobrem as fichas, o preenchimento do Fale Conosco e do formulário do imóvel, o código anti-robô, o WhatsApp Lead e a tag v3.

## Histórico de versões

- **2.1.1 (10/11/2026):** links que o agente escreve no formato `[texto](endereço)` aparecem como texto clicável, sem colchetes.
- **2.1 (10/11/2026):** leitura do site conferida nas páginas reais (links com hífen, imóvel sem código de referência, descrição e características da página, artigos com o título certo). Na página de um imóvel, o Worker lê a página na hora (`worker/src/aovivo.js`): preço, condomínio, IPTU, endereço, descrição e características atualizados, inclusive de imóvel recém-cadastrado (`LER_PAGINA_AO_VIVO` = "nao" desliga). Busca por rua (pelo endereço ou pela rua citada no anúncio). O catálogo passa a registrar a data em que cada imóvel entrou no site e os que saíram (`historico_desde`, `desde`, `sairam`); a ferramenta `imoveis_que_sairam` responde sobre eles, sempre como "saiu do site" (vendido ou retirado).
- **2.0 (10/11/2026):** o catálogo passa a ter tudo o que está à venda no site: além do feed (que vinha com 55 de 85 imóveis), o gerador lê a listagem do próprio site e acrescenta o que falta, em qualquer cidade; guarda também o resumo das páginas e dos artigos do blog. O agente ganhou: busca por cidade, "mais recentes primeiro", a ferramenta `consultar_site` (responde sobre blog, bairros, financiamento, o corretor, com o link) e o trecho do texto da página em que o visitante está. O microfone não corta mais nas pausas: ouve até a pessoa tocar de novo ou ficar 5 segundos em silêncio (`data-mic-pausa-segundos`). O `/saude` do Worker mostra de onde vieram os imóveis (`fontes`) e quantas páginas do site o agente conhece.
- **1.5.1 (07/11/2026):** o balão não espera mais o aviso de cookies: aparece no tempo normal e, enquanto o aviso estiver na tela, fica acima dele.
- **1.5 (07/11/2026):** balões para Venda seu Imóvel, Financiamento/Calculadora/Correspondente, Contato, Corretor, páginas de bairro e lista do blog; a busca (/imovel/?...) é reconhecida como lista; textos sem "Niterói" ("Procurando um imóvel? Posso ajudar."); a IA atende Niterói e região (Maricá, São Gonçalo), a busca aceita cidade e o resumo do catálogo mostra as cidades.
- **1.4.2 (07/11/2026):** o balão do imóvel passa a ser sempre "Gostou deste imóvel? Tiro suas dúvidas e agendo sua visita." (sem tipo nem bairro: o título da página não é confiável). O aviso de cookies só segura o balão se estiver realmente visível na tela, e por no máximo 12 segundos (`data-cookies-espera-segundos`); se continuar na tela, o balão aparece acima dele.
- **1.4.1 (07/11/2026):** balão do imóvel: "Gostou deste apartamento em Icaraí? Tiro suas dúvidas e agendo sua visita."; ao clicar, "Por onde prefere começar?" com os botões "Quero conhecer o imóvel", "Tenho uma pergunta" e "Ver opções semelhantes"; corrigido: depois de abrir o chat numa página, o balão não voltava mais a essa página na mesma aba.
- **1.4 (07/11/2026):** balões em toda página nova, com mensagem de acordo com a página (imóvel, lista, notícia com a rua ou o bairro citado, geral); o balão fica até a pessoa clicar ou fechar; fechado no X, volta na próxima página ou depois de 3 minutos; sem limite por visita; para de vez depois que a pessoa falou com o corretor.
- **1.3.1 (06/11/2026):** o chat se posiciona pela área visível da tela do celular. Na página inicial do site, um carrossel deixa a página mais larga que a tela (428 px numa tela de 375 px), e o botão do chat ficava meio escondido à direita.
- **1.3 (06/11/2026):** uma ficha de cada vez (a nova substitui a anterior do mesmo tipo, e o agente sabe que ela já está aberta); na despedida, só agradece; sugestões não aparecem por cima de uma ficha; o "Prefiro falar no WhatsApp" da ficha usa o nome e o telefone da própria ficha; títulos dos cartões sem "| Quinto"; a mensagem do WhatsApp não repete "quero falar com o corretor"; quem não sabe o valor recebe a dica do link da calculadora; na página de um imóvel, toda mensagem de WhatsApp leva o código e o link dele.
- **1.2 (06/11/2026):** lista de imóveis só em cartões; valores e telefones sem quebra de linha; o agente indica o botão do WhatsApp em vez de escrever o número; botão de microfone; valor obrigatório por faixas na busca, com link para a calculadora (endereço configurável em `CALCULADORA_URL`); as fichas completam tipo, bairro e quartos que o visitante disse; WhatsApp com nome e telefone direto e botão "Enviar mensagem pelo WhatsApp"; no computador abre o WhatsApp Web; textos mais naturais; a página de teste avisa quando está usando o agente de verdade.
- **1.1 (06/11/2026):** envia `reasoning_effort: "none"` para a OpenAI (o GPT-6 recusava as ferramentas sem isso).
- **1.0 (nov/2026):** primeira versão.
