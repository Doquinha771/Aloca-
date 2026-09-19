<div align="center">

# Equipa

**Gestão responsável de equipamentos escolares.**

![Versão](https://img.shields.io/badge/vers%C3%A3o-0.0.14-5d666d?style=for-the-badge)
![Plataforma](https://img.shields.io/badge/plataforma-web-69737a?style=for-the-badge)
![Estado](https://img.shields.io/badge/estado-piloto%20escolar-78838a?style=for-the-badge)
![Privacidade](https://img.shields.io/badge/privacidade-LGPD-626d74?style=for-the-badge)

</div>

---

O **Equipa** é uma plataforma web criada para organizar o uso de equipamentos de uma unidade escolar. O sistema reúne inventário, QR Codes, carrinhos, retiradas, devoluções, reservas, manutenção, administração e auditoria em um único ambiente.

A proposta é permitir que a equipe escolar saiba **qual equipamento está disponível, quem realizou uma retirada, quando ocorreu a devolução e qual é o histórico do patrimônio**, mantendo rastreabilidade sem transformar a rotina em uma planilha interminável.

## Funções

```text
Inventário de equipamentos
Grupos e identificação por tipo de dispositivo
Pesquisa inteligente e filtros
QR Code permanente por equipamento
QR Code por carrinho
Leitura de QR pelo celular
Download de QR Codes em lote
Retirada individual com prazo de devolução
Retirada seletiva por carrinho
Devolução com data e horário
Fila de retiradas atrasadas
Exclusão segura de cadastros sem histórico
Retirada de circulação de equipamento com histórico
Reservas futuras
Histórico por equipamento, pessoa e turma
Controle de manutenção
Importação e exportação de inventário
Aprovação e controle de acesso de usuários
Banimento e restauração de acesso
Auditoria administrativa
Termos de Uso versionados
Política de Privacidade versionada
Registro de aceite dos documentos legais
Interface adaptada para desktop e celular
```

## Equipamentos

O Equipa foi preparado para o inventário utilizado pela escola, incluindo:

```text
Chromebook
Positivo novo
Positivo técnico
Positivo antigo
ThinkPad Lenovo
Tablet
Outros equipamentos
```

Cada equipamento pode possuir número/código, patrimônio, grupo, fabricante, modelo, nome, número de série, localização, estado e observações operacionais.

## Carrinhos

Os carrinhos representam conjuntos físicos de equipamentos. Cada carrinho pode registrar nome, número, localização, capacidade, observações e os equipamentos vinculados.

Ao ler o QR de um carrinho, o usuário pode escolher **quais equipamentos serão retirados e quantos serão selecionados**, sem obrigar a retirada do lote inteiro.

## Segurança e privacidade

O Equipa adota autenticação individual, níveis de acesso, aprovação administrativa de novas contas, regras de acesso no banco de dados, auditoria e operações administrativas protegidas no servidor.

A chave presente no navegador possui apenas permissões públicas controladas. Credenciais administrativas e segredos de servidor não fazem parte dos arquivos públicos do site.

Os QR Codes funcionam como identificadores e não concedem, por si só, autorização para retirar ou alterar equipamentos. A execução de operações continua dependendo da conta autenticada e de suas permissões.

O tratamento de dados foi pensado segundo princípios da LGPD, incluindo finalidade, necessidade, minimização, segurança, transparência, rastreabilidade e preservação dos direitos dos titulares.

## Perfis

```text
Aluno
Professor
Administrador
```

Contas novas podem permanecer aguardando aprovação antes de receber acesso ao inventário. A administração pode ajustar cargos, remover acesso, restaurar contas e aplicar bloqueios quando necessário à segurança ou à rotina escolar.

## Auditoria

A área de auditoria permite acompanhar eventos relevantes, como alterações no inventário, movimentações, reservas, manutenção, carrinhos, contas e aceites legais. O histórico administrativo é preservado para evitar que a exclusão de um cadastro elimine a rastreabilidade de ações anteriores.

## Estado do projeto

```text
Nome        Equipa
Versão      0.0.13 · Hotfix 3
Plataforma  Web responsiva
Uso         Gestão de equipamentos escolares
Estado      Piloto / desenvolvimento
```

---

<div align="center">

**Equipa**  
feito pela equipe da coordenação da escola e 3-A do ensino médio.

</div>
