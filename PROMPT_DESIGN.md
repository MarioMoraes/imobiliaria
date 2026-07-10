# Extrator de Design a partir de HTML

## Contexto

Você recebe o HTML de um site de referência (`$ARGUMENTS`) e deve gerar uma **página única de documentação visual** que funciona como uma **biblioteca de padrões viva** — extraída diretamente do código original, sem reinventar nada.

O arquivo de saída deve se chamar `design-modelo.html` e ser salvo na mesma pasta do HTML de origem.

---

## Princípios Fundamentais

- **Fidelidade total**: classes CSS, animações, keyframes, transições, efeitos e estruturas de layout devem ser reutilizados tal como existem no original — sem aproximações, sem estilos inline inventados.
- **Só o que existe**: se um componente, estilo ou padrão não aparece no HTML de referência, ele não entra na documentação.
- **Documentação pela estrutura**: a própria organização das seções comunica o sistema. Cada seção é autodescritiva.
- **Assets compartilhados**: o arquivo deve referenciar os mesmos CSS/JS do site original.
- **Navegação interna**: incluir um nav horizontal fixo no topo com âncoras para cada seção.

---

## Seções Obrigatórias

### 0 · Hero — Clone Adaptado

A primeira seção é uma **réplica exata do hero original**:

- Mesma estrutura HTML, classes, layout, imagens, botões, backgrounds e animações
- Mesmos componentes de UI embutidos (se houver)

**Única alteração permitida:** trocar o texto para apresentar o Design System, mantendo hierarquia e comprimento similares ao original.

**Proibido:** alterar espaçamentos, alinhamentos, ordem de elementos ou comportamentos visuais.

---

### 1 · Tipografia — Catálogo Vertical

Montar uma lista/tabela de especificação tipográfica. Cada entrada contém:

| Coluna | Conteúdo |
|---|---|
| Nome do estilo | Ex: "Título 1", "Negrito M", "Parágrafo" |
| Preview ao vivo | Texto renderizado com o **elemento e classes CSS originais** |
| Métricas | `font-size / line-height` alinhado à direita (ex: `40px / 48px`) |

**Ordem de prioridade** (incluir somente os que existem no original):

Título 1 → Título 2 → Título 3 → Título 4 → Negrito G / Negrito M / Negrito P → Parágrafo (corpo maior, se houver) → Regular G / Regular M / Regular P

**Regras:**
- Sem estilos inline — tudo vem do CSS original
- Se o estilo usa texto com gradiente, reproduzir identicamente
- A seção deve comunicar **hierarquia, escala e ritmo** de forma imediata

---

### 2 · Cores e Superfícies

Documentar as camadas visuais do design:

- **Backgrounds**: página, seções, cards, efeitos glass/blur (se existirem)
- **Bordas e divisores**: linhas, separadores, overlays
- **Gradientes**: apresentar como swatches com contexto de uso

---

### 3 · Componentes de Interface

Catalogar apenas os componentes presentes no original:

- Botões, inputs, cards, badges, tags, etc.
- Exibir estados lado a lado: `padrão` · `hover` · `active` · `focus` · `disabled`
- Inputs: incluir estados `default` / `focus` / `erro` quando aplicável

---

### 4 · Layout e Espaçamento

Demonstrar os padrões estruturais do site:

- Containers, grids, colunas, paddings de seção
- Reproduzir 2–3 composições reais extraídas da referência (ex: layout do hero, grid de cards, seção dividida)

---

### 5 · Movimento e Interação

Catalogar todos os comportamentos de motion presentes:

- Animações de entrada (fade-in, slide-up, etc.)
- Efeitos hover (elevação, glow, scale)
- Transições de botão
- Comportamentos de scroll/reveal (apenas se existirem)

Montar uma **galeria de motion** compacta demonstrando cada classe de animação em ação.

---

### 6 · Iconografia (condicional)

**Incluir apenas se o original utilizar ícones.**

- Exibir no mesmo sistema/estilo do original (SVG, icon font, etc.)
- Mostrar variantes de tamanho e herança de cor
- Usar a mesma marcação e classes

Se não houver ícones no HTML de referência, omitir esta seção por completo.