# Site institucional — Offices Tecnologia

Página única (`index.html`), estática e sem build. Abra o arquivo direto no
navegador ou sirva a pasta:

```bash
npx serve site
# ou
python3 -m http.server 8080 --directory site
```

## Seções

Header → hero → **Serviços (01)** → **Offices AI Imobiliária** → "O desafio." →
Processo → Contato → rodapé.

## Design

O layout, as cores, a tipografia e as animações replicam o template
`fluxora-ai-infrastruc-44.aura.build`, indicado como referência.

| Elemento | Valor |
| --- | --- |
| Fundo | `neutral-950` (#0a0a0a) sobre malha SVG de 64px a 3% de opacidade |
| Acento | `blue-400` #60a5fa · `blue-500` #3b82f6 · `blue-300` #93c5fd |
| Fonte | Inter 300–700 |
| Cartões | `linear-gradient(225deg, transparent, rgba(255,255,255,.05), transparent)` + raio 24px |
| Borda | `.border-gradient` — borda de 1px em gradiente via `mask-composite` |
| Entrada | `@keyframes fadeSlideIn` (opacidade + `translateY(30px)` + `blur(8px)`), disparada por `IntersectionObserver` com atraso escalonado por cartão |
| Reduced motion | `prefers-reduced-motion` desliga o fundo animado |

Duas substituições em relação ao original, porque os recursos são de terceiros:

- **Fundo animado** — o template usa uma cena WebGL hospedada na Unicorn Studio.
  Aqui o efeito é reproduzido em `<canvas>` (blobs radiais em movimento com
  composição `lighter`), sem dependência externa.
- **Imagens** — o template carrega fotos do storage da Aura. Todos os visuais
  aqui são desenhados em CSS/SVG (painel do sistema, mockups das seções), então
  a única imagem da página é o logo — e ela é vetorial e local.

### Marca

`assets/logo-offices.svg` — usado no header, no rodapé e como favicon.

Composto de duas partes:

- **o disco** — `<circle>` com gradiente linear horizontal `#a6a6a6 → #ffffff`
  (medido pixel a pixel na arte original) e um fio de contorno `#333` de
  `stroke-width: 1.5` no espaço do viewBox, ou seja, um fio de cabelo que só
  aparece em tamanhos grandes;
- **a palavra** — contornos vetoriais traçados da arte original com `potrace`,
  não texto. A letra é exatamente a da marca e não depende de fonte instalada.

A tipografia da marca é uma **itálica da família Bodoni**. Comparando glifo a
glifo (`o f c e s`) contra 26 serifadas, a mais próxima é **Libre Bodoni
Italic** (Google Fonts) — bem à frente de qualquer fonte do sistema. Use-a se
precisar compor texto novo no mesmo estilo; para o símbolo em si, use o SVG,
que é a arte real.

## Dependências (CDN)

Só duas: Tailwind CSS e Iconify. O Chart.js saiu junto com o bento grid. Para
produção, vale trocar o Tailwind CDN por um CSS compilado.

## Dados de contato

| Canal | Valor |
| --- | --- |
| E-mail | contato@office-cloud.ia |
| WhatsApp | (35) 99252-7113 → `wa.me/5535992527113` |
| Instagram | [@offices_aplicativos](https://instagram.com/offices_aplicativos) |
| SaaS | https://imobiliaria.officestecnologia.com.br |

O link do SaaS está no selo do hero, no CTA "Conhecer o sistema" e no rodapé.

## Antes de publicar

Os valores do painel do Offices AI Imobiliária são ilustrativos (R$ 482 mil,
318 contratos, 2,4% de inadimplência). Troque pelos reais ou remova.
