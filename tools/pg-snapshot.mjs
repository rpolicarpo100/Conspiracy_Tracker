/* Cópia de segurança da base Postgres (e listagem dos pontos guardados).

   Uso:
     node tools/pg-snapshot.mjs                 → cria uma cópia do documento actual
     node tools/pg-snapshot.mjs --listar        → lista as cópias guardadas
     node tools/pg-snapshot.mjs --restaurar 12  → repõe a cópia com id 12
                                                (avança a versão, não apaga nada)

   Exige DATABASE_URL no ambiente. Nunca imprime a ligação nem o conteúdo dos
   dados: mostra versões, datas e tamanhos. */
import { createPgStore } from '../server/pg.mjs';

const url = process.env.DATABASE_URL || '';
if (!url) {
  console.error('DATABASE_URL não está definida: nada a fazer.');
  console.error('Sem base configurada, as cópias de segurança são os ficheiros db-backup-*.json do DATA_DIR.');
  process.exit(2);
}

const pg = createPgStore(url, {});
await pg.init();

if (process.argv.includes('--listar')) {
  const lista = await pg.snapshots();
  if (!lista.length) console.log('sem cópias guardadas (crie uma com: node tools/pg-snapshot.mjs)');
  for (const s of lista) console.log('#' + s.id + '  versão ' + s.version + '  ' + new Date(s.at).toISOString().slice(0, 19).replace('T', ' ') + '  ' + Math.round(s.bytes / 1024) + ' KB');
} else if (process.argv.includes('--restaurar')) {
  const id = Number(process.argv[process.argv.indexOf('--restaurar') + 1]);
  if (!id) { console.error('indique o id da cópia: --restaurar 12'); process.exit(3); }
  const r = await pg.restoreSnapshot(id);
  if (!r) { console.error('cópia #' + id + ' não encontrada'); process.exit(4); }
  console.log('restaurada a cópia #' + r.fromSnapshot + ' (versão ' + r.snapshotVersion + ') como versão ' + r.newVersion);
  console.log('a versão anterior não foi apagada: continua nas cópias guardadas.');
} else {
  const r = await pg.snapshot();
  if (!r) { console.error('a base ainda não tem documento para copiar'); process.exit(5); }
  console.log('cópia criada da versão ' + r.version + ' (mantidas as ' + r.kept + ' mais recentes)');
}

const estado = await pg.probe();
console.log('base: ' + estado.database + ' · versão ' + estado.version + ' · latência ' + estado.latencyMs + ' ms · erros acumulados ' + estado.errors);
await pg.close();
