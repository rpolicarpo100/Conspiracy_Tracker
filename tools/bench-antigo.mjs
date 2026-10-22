/* =====================================================================
   MOTOR ANTIGO vs MOTOR NOVO — a mesma consulta, o mesmo texto (fase 12)

   Serve para uma coisa só: provar com números o que se perdeu e o que se
   ganhou ao trocar a comparação de substring por termos independentes.

   Motor ANTIGO (o que estava em produção até à fase 11):
     fold(texto).includes(fold(consulta))  — a consulta INTEIRA como uma só
     cadeia. «financiou 2019» só casa se essas duas palavras estiverem
     seguidas, naquela ordem, no mesmo campo.

   Motor NOVO (server/search.mjs): termos independentes (E), prefixo a partir
   de 3 letras, acentos e caixa indiferentes, "frases", -exclusão.

   Corpus: os mesmos 6 textos de família de tools/bench-search.mjs, replicados
   para 320 documentos. Nada disto é dado real de investigação: é texto
   declaradamente sintético, e só mede o motor.
   ===================================================================== */
import { fold, parseQuery, pontuarTexto } from '../server/search.mjs';

const FAMILIAS = [
  { id: 'gulbenkian', texto: 'A Fundação Calouste Gulbenkian financiou o projecto em 2019 com 250 mil euros, segundo o relatório de contas.',
    consultas: ['gulbenkian', 'fundação calouste', 'financiou 2019', 'fundacao gulbenkian', 'financ'] },
  { id: 'misericordia', texto: 'A Irmandade da Santa Casa da Misericórdia de Lisboa atribuiu um subsídio à associação em 2020.',
    consultas: ['misericórdia', 'santa casa lisboa', 'misericordia lisboa', 'subsídio 2020'] },
  { id: 'tejo', texto: 'Contrato público adjudicado à empresa Construções do Tejo, SA, por ajuste directo, conforme o portal BASE.',
    consultas: ['tejo', 'construções tejo', 'ajuste directo', 'contrato público adjudicado'] },
  { id: 'saude', texto: 'O Ministério da Saúde transferiu verbas para a Administração Regional de Saúde do Norte em 2021.',
    consultas: ['ministério saúde', 'administração regional norte', 'verbas 2021', 'transferiu verbas'] },
  { id: 'banca', texto: 'O Banco de Portugal aplicou uma coima por incumprimento na prevenção do branqueamento de capitais.',
    consultas: ['banco portugal', 'coima branqueamento', 'prevenção capitais'] },
  { id: 'camara', texto: 'A Câmara Municipal de Lisboa aprovou a deliberação que autoriza a permuta de terrenos municipais.',
    consultas: ['câmara lisboa', 'permuta terrenos', 'deliberação municipal'] }
];

/* 320 documentos, tal como a bancada os cria (o código único não entra na
   pesquisa: serve só para identificar o alvo) */
const docs = [];
for (let i = 0; i < 8; i++) {
  for (let j = 0; j < 40; j++) {
    const f = FAMILIAS[(i * 40 + j) % FAMILIAS.length];
    docs.push({ id: 'ZQ' + i + 'X' + j, familia: f.id, texto: f.texto });
  }
}

const antigo = (texto, q) => fold(texto).includes(fold(q));
const novo = (texto, q) => !!pontuarTexto(texto, parseQuery(q));
const conta = (q, f) => docs.filter((d) => f(d.texto, q)).length;
const acerta = (q, familia, f) => docs.filter((d) => d.familia === familia && f(d.texto, q)).length > 0;

let total = 0, okAntigo = 0, okNovo = 0, falsoAntigo = 0;
const linhas = [];
for (const fam of FAMILIAS) {
  for (const q of fam.consultas) {
    total++;
    const a = acerta(q, fam.id, antigo);
    const n = acerta(q, fam.id, novo);
    if (a) okAntigo++; else linhas.push([q, 'antigo NÃO encontra o próprio documento']);
    if (n) okNovo++; else linhas.push([q, 'novo NÃO encontra o próprio documento']);
    if (!a) falsoAntigo += 0;
  }
}

/* Consultas de dois termos: é aqui que a substring se distingue de E. */
const doisTermos = [];
for (const fam of FAMILIAS) {
  for (const q of fam.consultas) {
    if (q.split(/\s+/).length >= 2) doisTermos.push([q, fam.id, acerta(q, fam.id, antigo), acerta(q, fam.id, novo)]);
  }
}
const dtAntigo = doisTermos.filter((x) => x[2]).length;
const dtNovo = doisTermos.filter((x) => x[3]).length;

console.log('MOTOR ANTIGO (substring da consulta inteira) vs MOTOR NOVO — ' + docs.length + ' documentos, ' + total + ' consultas\n');
console.log('consultas que encontram o próprio documento');
console.log('  antigo: ' + okAntigo + '/' + total);
console.log('  novo  : ' + okNovo + '/' + total);
console.log('\nconsultas com 2 ou mais termos (onde a substring falha)');
console.log('  antigo: ' + dtAntigo + '/' + doisTermos.length);
console.log('  novo  : ' + dtNovo + '/' + doisTermos.length);
console.log('\ndetalhe das consultas com dois ou mais termos:');
doisTerminosLinhas();
function doisTerminosLinhas() {
  for (const [q, fam, a, n] of doisTermos) {
    console.log('  ' + (q + '                         ').slice(0, 26) + ' antigo ' + (a ? 'sim' : 'não') + ' · novo ' + (n ? 'sim' : 'não'));
  }
}
const falhas = linhas.filter(([, m]) => /novo NÃO/.test(m));
console.log('\nfalhas do motor novo: ' + falhas.length);
process.exit(falhas.length ? 1 : 0);
