# Ícones do PWA — Sistema Jurídico

Este diretório contém os ícones utilizados pelo Web App Manifest (`public/manifest.json`) para instalação do PWA nos dispositivos dos usuários.

## ⚠️ Substituição Obrigatória

Os arquivos de ícone presentes neste diretório são **placeholders de 1×1 pixel transparentes** gerados automaticamente. Eles devem ser substituídos por ícones reais com o logo do Sistema Jurídico antes do deploy em produção.

## Tamanhos Necessários

| Arquivo                        | Tamanho  | Finalidade                                        |
|--------------------------------|----------|---------------------------------------------------|
| `icon-72x72.png`               | 72×72    | Android (launcher pequeno)                        |
| `icon-96x96.png`               | 96×96    | Android (launcher médio)                          |
| `icon-128x128.png`             | 128×128  | Chrome Web Store / Desktop                        |
| `icon-144x144.png`             | 144×144  | Android (launcher grande) / Windows               |
| `icon-152x152.png`             | 152×152  | iOS (iPad)                                        |
| `icon-192x192.png`             | 192×192  | Android (splash screen / notificações)            |
| `icon-192x192-maskable.png`    | 192×192  | Android (adaptive icon — fundo seguro obrigatório)|
| `icon-384x384.png`             | 384×384  | Android (alta densidade)                          |
| `icon-512x512.png`             | 512×512  | Play Store / Chrome installable                   |
| `icon-512x512-maskable.png`    | 512×512  | Android (adaptive icon grande — maskable)         |

## Diretrizes para os Ícones

### Ícones `purpose: any`
- Fundo pode ser transparente ou colorido.
- O logo deve ocupar a maior parte da área útil.
- Cor de tema da marca: `#1e40af` (blue-800).

### Ícones `purpose: maskable`
- O conteúdo visual principal deve ficar dentro da **safe zone** de 80% central.
- O fundo deve preencher 100% do canvas com a cor `#1e40af` para evitar bordas brancas em dispositivos Android com adaptive icons.
- Use a ferramenta [maskable.app/editor](https://maskable.app/editor) para validar o recorte.

## Screenshots

O diretório `public/screenshots/` deve conter:

| Arquivo                   | Tamanho   | Finalidade                |
|---------------------------|-----------|---------------------------|
| `screenshot-desktop.png`  | 1280×800  | Preview desktop no prompt |
| `screenshot-mobile.png`   | 390×844   | Preview mobile no prompt  |

## Ferramentas Recomendadas

- **[RealFaviconGenerator](https://realfavicongenerator.net/)** — geração a partir de um SVG/PNG fonte
- **[PWA Image Generator](https://www.pwabuilder.com/imageGenerator)** — gera todos os tamanhos de uma vez
- **[maskable.app](https://maskable.app/editor)** — validação de ícones maskable
