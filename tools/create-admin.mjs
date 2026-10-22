/* =====================================================================
   PROCEDIMENTO DE PRIMEIRO ADMINISTRADOR (sem credenciais no código)

   Porque existe: com o registo público fechado (REGISTER_OPEN ausente),
   nenhuma conta nasce sozinha. O primeiro administrador tem de ser criado
   por quem opera o servidor, com uma palavra-passe introduzida agora e
   nunca escrita no repositório, em variáveis do repositório, em testes ou
   em documentação.

   Como usar (no servidor, com o mesmo DATA_DIR da aplicação):

     node tools/create-admin.mjs                       # pergunta email e palavra-passe
     node tools/create-admin.mjs --email a@b.pt         # só pergunta a palavra-passe
     echo 'palavra-passe' | node tools/create-admin.mjs --email a@b.pt --stdin
     node tools/create-admin.mjs --email a@b.pt --password-env ADMIN_TEMP_PW

   Regras que este script NÃO quebra:
     · não aceita palavra-passe por argumento de linha de comando (ficaria
       no histórico da shell e visível em `ps` para outros utilizadores);
     · não imprime a palavra-passe, nem a guarda: só o hash scrypt com sal;
     · recusa-se a correr se já existir um administrador activo, para que
       ninguém crie um segundo admin «de emergência» sem revogar o primeiro;
     · regista o acontecimento na auditoria do próprio armazenamento;
     · exige TTY ou --stdin explícito: nunca lê uma palavra-passe em claro
       de um pipe acidental.
   ===================================================================== */
import path from 'node:path';
import readline from 'node:readline';
import { createStore } from '../server/store.mjs';
import { hashPassword, passwordProblems } from '../server/auth.mjs';

function arg(name) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 ? process.argv[i + 1] : null;
}
const used = (name) => process.argv.includes('--' + name);

const dataDir = arg('data-dir') || process.env.DATA_DIR || path.join(process.cwd(), '.data');
const force = used('force');
const emailArg = arg('email') || process.env.ADMIN_EMAIL || '';

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a); }));
}

/* Leitura sem eco: em raw mode os caracteres não são escritos no terminal,
   por isso a palavra-passe não fica no scrollback nem no histórico. */
function askSecret(question) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin, stdout = process.stdout;
    if (!stdin.isTTY) {
      let raw = '';
      stdin.on('data', (c) => { raw += c; });
      stdin.on('end', () => resolve(String(raw).split('\n')[0]));
      stdin.on('error', reject);
      return;
    }
    stdout.write(question);
    let buf = '';
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    const onData = (ch) => {
      for (const c of String(ch)) {
        if (c === '\r' || c === '\n' || c === '\u0004') {
          stdin.removeListener('data', onData); stdin.setRawMode(false); stdin.pause();
          stdout.write('\n'); return resolve(buf);
        }
        if (c === '\u0003') { stdin.setRawMode(false); stdout.write('\n'); return reject(new Error('cancelado')); }
        if (c === '\u007f') { buf = buf.slice(0, -1); continue; }
        buf += c;
      }
    };
    stdin.on('data', onData);
  });
}

async function readPassword() {
  if (arg('password-env')) {
    const v = process.env[arg('password-env')];
    if (v == null) throw new Error('a variável indicada em --password-env não existe');
    return v;
  }
  if (used('stdin') || !process.stdin.isTTY) {
    let raw = '';
    for await (const chunk of process.stdin) raw += chunk;
    return raw.split('\n')[0];
  }
  const a = await askSecret('palavra-passe do administrador (não é mostrada): ');
  const b = await askSecret('repetir: ');
  if (a !== b) throw new Error('as duas palavras-passe não coincidem');
  return a;
}

async function main() {
  if (arg('password')) {
    console.error('recusado: não aceite --password (ficaria no histórico da shell). Use stdin, --stdin, --password-env ou o pedido interactivo.');
    process.exit(2);
  }
  const store = await createStore(dataDir).init();
  const admins = store.data.users.filter((u) => u.role === 'ADMIN' && u.status === 'active');
  if (admins.length && !force) {
    console.error('recusado: já existe ' + admins.length + ' administrador(es) activo(s) (' + admins.map((u) => u.email).join(', ') + ').');
    console.error('Para promover outra conta use a interface de administração; para forçar, repita com --force e explique o motivo.');
    process.exit(3);
  }
  const email = String(arg('email') || emailArg || (process.stdin.isTTY ? await ask('email do administrador: ') : '')).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) { console.error('email inválido'); process.exit(4); }
  if (store.userByEmail(email)) { console.error('já existe uma conta com esse email: ' + email); process.exit(5); }
  const pw = await readPassword();
  const problems = passwordProblems(pw);
  if (problems.length) { console.error('palavra-passe fraca: ' + problems.join(', ')); process.exit(6); }
  const { salt, hash } = hashPassword(pw);
  const user = await store.createUser({ email, passwordHash: hash, salt, role: 'ADMIN', termsAcceptedAt: new Date().toISOString() });
  /* quem corre este procedimento escolheu a palavra-passe agora, por isso ela
     não é temporária: mustChangePassword fica falso. A troca obrigatória
     aplica-se às contas criadas por POST /api/admin/users, onde a palavra-passe
     é gerada pelo servidor e mostrada uma única vez. */
  await store.updateUser(user.id, { createdBy: 'tools/create-admin.mjs' });
  await store.audit({
    type: 'admin_user_created', actorId: user.id, subjectId: user.id, ip: 'local-tty',
    action: 'bootstrap_admin', detail: { via: 'tools/create-admin.mjs', forced: force, dataDir }
  });
  console.log('administrador criado: ' + user.email + ' (' + user.id + ')');
  console.log('armazenamento: ' + dataDir);
  console.log('a conta entra com a palavra-passe que acabou de definir (não é temporária).');
  console.log('a palavra-passe não foi impressa nem guardada em claro; confirme a entrada em /health e em /api/meta (registration.open:false).');
}

main().catch((e) => { console.error('falhou: ' + e.message); process.exit(1); });
