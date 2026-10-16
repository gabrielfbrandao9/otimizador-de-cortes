# Otimizador de Cortes

Calculadora de **plano de corte** para chapas de MDF, MDP, compensado, vidro, acrílico e outros materiais.
Informe as peças e as chapas disponíveis, e o site calcula como cortar tudo com o menor desperdício.

Funciona no navegador, sem servidor nem cadastro. É só HTML, CSS e JavaScript.

## Funcionalidades

- **Otimização automática**: algoritmo guilhotina, em que cada corte atravessa a peça de ponta a ponta, como numa esquadrejadeira. O mesmo plano é calculado com mais de 200 combinações de heurísticas e o melhor é mantido.
- **Várias chapas**: diferentes tamanhos e materiais, cada um com sua quantidade. Cada peça pode ser presa a uma chapa específica (coluna **Chapa**) ou ficar em *Qualquer*.
- **Ativar e desativar** peças e chapas com uma caixa de seleção, sem precisar apagá-las.
- **Espessura da serra** (kerf) e **refilo** das bordas da chapa.
- **Veio da madeira**: cada peça pode ser *livre* (pode girar), seguir o comprimento ou seguir a largura da chapa.
- **Diagrama visual** com nomes, medidas, sobras e linhas de corte. Chapas iguais são agrupadas (×N).
- **Visualização**: zoom, tamanho das letras, colorido ou sem cores, horizontal ou vertical e **ordem dos cortes** com passo a passo.
- **Estatísticas**: aproveitamento, área usada e de sobra, número de cortes e metros de corte.
- **Salvar e exportar**:
  - **projetos na nuvem** com login por Google ou e-mail, acessíveis de qualquer aparelho (Supabase, opcional; veja [SUPABASE.md](SUPABASE.md));
  - salvamento automático e projetos nomeados no navegador (localStorage);
  - exportar e importar o projeto em `.json`;
  - exportar e importar a lista de peças em `.csv` (abre no Excel);
  - baixar cada chapa como imagem `.png`;
  - imprimir ou salvar em PDF.

## Aplicativo para Android

O site é também um **aplicativo instalável (PWA)**:

1. No celular Android, abra o site no **Chrome**.
2. Toque em **Instalar app** (no topo da página) ou no menu ⋮ → **Instalar app** / **Adicionar à tela inicial**.
3. O ícone **Cortes** aparece na tela inicial. O app abre em tela cheia, com abas
   (Peças · Chapas · Opções · Plano) e **funciona sem internet** depois da primeira abertura.

Atualizações chegam sozinhas: a cada `git push`, o app pega a versão nova na próxima vez que abrir com internet.
O login e os projetos na nuvem precisam de conexão; o resto funciona offline.

Arquivos do app: `manifest.webmanifest`, `sw.js` (funcionamento offline) e a pasta `icons/`.
Ao adicionar um arquivo novo ao site, inclua-o na lista `APP_FILES` do `sw.js` e aumente a `VERSION`.

## Como usar localmente

Abra o `index.html` direto no navegador, ou sirva a pasta:

```bash
python -m http.server 8000
```

Depois acesse http://localhost:8000.

## Publicar no GitHub Pages

1. Crie um repositório vazio no GitHub, por exemplo `otimizador-de-cortes`.
2. Nesta pasta, rode:

   ```bash
   git remote add origin https://github.com/SEU-USUARIO/otimizador-de-cortes.git
   git push -u origin main
   ```

3. No GitHub, vá em **Settings → Pages**. Em *Source*, escolha **Deploy from a branch**, depois a branch `main` e a pasta `/ (root)`.
4. Em um ou dois minutos o site estará em `https://SEU-USUARIO.github.io/otimizador-de-cortes/`.

## Salvar projetos na nuvem

Por padrão os projetos ficam salvos só no navegador. Para ter login e projetos online,
siga o passo a passo em **[SUPABASE.md](SUPABASE.md)** (gratuito, cerca de 15 minutos).
Depois de configurado, aparece o botão **Entrar** no topo do site, e **Salvar** (ou Ctrl+S) envia o projeto para a nuvem.

## Formato do CSV de peças

Separador `;` (padrão do Excel em português) ou `,`. A primeira linha pode ser um cabeçalho.

```
nome;comprimento;largura;quantidade;veio;chapa
Lateral;720;550;2;comprimento;MDF 18mm
Porta;716;397;4;comprimento;MDF 18mm
Fundo;780;700;1;livre;HDF 3mm
```

- `veio`: `livre`, `comprimento` ou `largura`.
- `chapa` (opcional): o nome de uma chapa cadastrada no projeto. Vazio = qualquer chapa.
- `ativa` (opcional): `0` para importar a peça desativada. Vazio ou `1` = ativa.

CSVs antigos, com as colunas `fita_c1;fita_c2;fita_l1;fita_l2` depois do `veio`, continuam sendo importados; essas colunas são ignoradas.

Há um exemplo em [`exemplos/pecas-exemplo.csv`](exemplos/pecas-exemplo.csv).

## Estrutura

```
index.html          página
css/style.css       estilos (tema claro/escuro e impressão)
js/optimizer.js     algoritmo de otimização (sem dependências)
js/render.js        desenho das chapas em SVG e exportação PNG
js/storage.js       localStorage, JSON e CSV
js/config.js        endereço e chave do Supabase
js/cloud.js         login e projetos na nuvem (Supabase)
js/app.js           interface
supabase/schema.sql tabela e regras de segurança do banco
```

## Limitações

- O plano é uma boa solução, não necessariamente a ótima matemática (o problema é NP-difícil).
- Acima de 300 peças o cálculo deixa de ser automático a cada alteração: use o botão **Calcular**.
