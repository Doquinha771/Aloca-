<div align="center">

# Equipa

**Gestão escolar de equipamentos, reservas, retiradas e manutenção em uma plataforma web leve.**

![Version](https://img.shields.io/badge/version-0.0.12-5f6b76?style=for-the-badge)
![Platform](https://img.shields.io/badge/platform-web-4f5b67?style=for-the-badge)
![Frontend](https://img.shields.io/badge/frontend-GitHub%20Pages-333333?style=for-the-badge&logo=github)
![Backend](https://img.shields.io/badge/backend-Supabase-3d4650?style=for-the-badge&logo=supabase&logoColor=white)
![LGPD](https://img.shields.io/badge/privacy-LGPD-657484?style=for-the-badge)

</div>

---

O **Equipa** é uma plataforma para controle de equipamentos escolares. O projeto centraliza inventário, QR Codes, retiradas, devoluções, reservas, carrinhos, manutenção, histórico e administração sem depender de servidor local ou etapa de build.

A interface é publicada diretamente no **GitHub Pages** e utiliza **Supabase** para autenticação, banco de dados e regras de segurança.

## Funções

```text
Autenticação de usuários
Perfis de aluno, professor e administrador
Inventário de equipamentos
Cadastro manual e importação por CSV/XLSX
Pesquisa inteligente
Filtros avançados
QR Code permanente por equipamento
Leitor de QR Code no celular
Carrinhos de equipamentos por QR
Retirada individual e em lote
Devolução de equipamentos
Reservas futuras com prevenção de conflito
Histórico de movimentações
Controle de manutenção
Administração de usuários e cargos
Exportação de inventário
Monitoramento do uso do banco de dados
Menus de contexto para edição e exclusão
Termos de Uso e Política de Privacidade versionados
Registro de aceite dos documentos legais
Row Level Security no Supabase
Interface responsiva para desktop e mobile
```

## Instalação

O Equipa não precisa de Node.js, npm ou servidor local.

1. Extraia os arquivos do projeto.
2. Envie o conteúdo da raiz para o repositório GitHub.
3. Abra **Settings > Pages** no repositório.
4. Configure a publicação usando a branch `main` e a pasta `/(root)`.
5. Aguarde a publicação do GitHub Pages.

A configuração do Supabase utilizada pelo frontend fica em:

```text
assets/js/config.js
```

Somente a **publishable key** pode existir no frontend público. Chaves `service_role` ou `sb_secret` nunca devem ser adicionadas ao repositório.

## Estrutura

```text
Equipa/
├── index.html
├── .nojekyll
├── README.md
├── assets/
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── app.js
│       ├── config.js
│       └── supabase.js
└── supabase/
    └── migrations/
```

## Privacidade e LGPD

O Equipa foi estruturado com minimização de dados e controle de acesso por função.

Entre as medidas atuais estão:

- autenticação individual;
- Row Level Security nas tabelas expostas;
- uso exclusivo de publishable key no navegador;
- QR Codes sem dados pessoais embutidos;
- ocultação de e-mails no painel administrativo;
- coleta limitada ao necessário para operação escolar;
- registro da versão aceita dos Termos de Uso e da Política de Privacidade;
- retenção e arquivamento planejados para registros operacionais;
- separação entre permissões de alunos, professores e administradores;
- leitor de QR sem armazenamento das imagens capturadas pela câmera.

A unidade escolar continua responsável por definir formalmente o controlador, o encarregado/canal de privacidade, os prazos institucionais de retenção e as bases legais aplicáveis a cada tratamento antes da adoção oficial.

## Desenvolvimento

O frontend utiliza HTML, CSS e JavaScript puro, sem compilação.

```text
Frontend     HTML + CSS + JavaScript
Hospedagem   GitHub Pages
Backend      Supabase
Banco        PostgreSQL
Auth         Supabase Auth
Segurança    RLS + funções RPC controladas
Importação   SheetJS carregado sob demanda
QR           QRCodeJS e jsQR carregados sob demanda
```

Mudanças de banco ficam versionadas em `supabase/migrations`.

## Estado do projeto

```text
Nome        Equipa
Versão      0.0.12
Plataforma  Web responsiva
Frontend    GitHub Pages
Backend     Supabase
Estado      Em desenvolvimento / piloto escolar
```

---

<div align="center">

**Equipa**  
Tecnologia simples para saber onde cada equipamento está e quem está usando.

</div>
