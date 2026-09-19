# Equipa 0.2.0 Alpha · Anotações técnicas

A plataforma permanece no GitHub Pages (frontend estático) e no mesmo projeto Supabase já utilizado pelo Aloca+/Dasein/Equipa. O Pages não executa migrations.

## Dados e compatibilidade

As migrations da Alpha acrescentam campos à tabela de reservas e aos itens de retirada, criam uma tabela pequena para recibos temporários e mantêm os UUIDs, os QRs e as chaves estrangeiras anteriores. O estado físico de equipamento continua em `available`, `in_use`, `maintenance` ou `unavailable`; reservas futuras pertencem à agenda e não alteram automaticamente o estado físico para `reserved`.

Reservas por quantidade são formadas por linhas em `reservations` compartilhando `batch_id` e `start_at`. O índice de exclusão GiST já existente impede horários conflitantes por equipamento. Um checkout atribui o mesmo `withdrawal_id` às linhas da mesma ocorrência. A constraint de unicidade antiga em `reservations.withdrawal_id` foi substituída por índice não único porque uma retirada em lote corresponde a vários itens reservados.

## Segurança

Os novos endpoints são invocadores no schema `public`; suas implementações privilegiadas permanecem no schema `private` com verificação de `auth.uid()` e cargo ativo. Anônimos não recebem EXECUTE. Consultas diretas de reservas continuam sujeitas a RLS. Recibos de idempotência têm RLS ativa, sem concessões de leitura ou escrita para o navegador.

## Limites do Alpha

A reserva por quantidade é atômica; o backend retorna falta de estoque sem criar reserva parcial. A recorrência semanal pode ter até 12 ocorrências, no máximo 60 equipamentos, com até 90 dias de antecedência. A prévia é informativa: o backend valida e bloqueia novamente ao confirmar.

A devolução registra cada condição, sem concluir a retirada enquanto houver itens ausentes ou pendentes. Uma avaria cancela futuras reservas confirmadas daquele equipamento e abre registro de manutenção; a escola deve comunicar operacionalmente os responsáveis pelas reservas canceladas. O sistema ainda não envia avisos externos automatizados. Equipamentos atualmente emprestados não entram nas seleções de novas reservas em lote, mesmo que o prazo de devolução seja anterior à data solicitada; esta decisão conservadora evita prometer equipamento antes da conferência de retorno.

## Testes e publicação

O teste transacional versionado usa registros sintéticos com rollback e não deixa computadores fictícios no inventário. A execução depende de uma conta administradora ativa no banco. Testes de autenticação end-to-end, corrida real entre processos distintos e o fluxo físico de uma turma ainda devem ser conduzidos em ambiente de teste/piloto antes do uso geral. O teste de interface foi feito com sessão e respostas simuladas para os perfis Aluno/Administrador em desktop e mobile. O teste HTTP em navegador foi bloqueado pelo ambiente de execução e não foi contabilizado como aprovação.

A Alpha não implementa ainda um novo cargo Funcionário/Técnico com suas políticas, notificações externas automáticas, importação DOCX estruturada ou uma rotina automática de limpeza/arquivamento de todos os logs históricos. O código do frontend no GitHub Pages continua público por natureza; a autorização é imposta no Supabase e não pela ocultação dos arquivos. Os textos legais precisam de revisão e identificação do canal de privacidade pela unidade escolar antes de adoção geral.

Para uma instalação totalmente nova, os arquivos históricos deste pacote pressupõem o esquema-base do Aloca+ (migrations antigas anteriores à conversão para web). O pacote da Alpha não substitui o backup integral desse esquema-base. Não execute migrations antigas novamente sobre a produção já atualizada.
