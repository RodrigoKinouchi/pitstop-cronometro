import { initAuto } from './auto.js';

const STORAGE_KEY = 'pitstop-cronometro-v1';
// Nomes = arquivo em membros/<Nome>.jpg (exceto espaços, que também batem com o arquivo)
const FOTOS = {
  Bryan: 'Bryan.jpg', Chico: 'Chico.jpg', Douglas: 'Douglas.jpg', Eder: 'Eder.jpg',
  Erich: 'Erich.jpg', Fabiano: 'Fabiano.jpg', Guiga: 'Guiga.jpg', Henrique: 'Henrique.jpg',
  Joao: 'Joao.jpg', 'Leo Barboza': 'Leo Barboza.jpg', Lucas: 'Lucas.jpg', Marcio: 'Marcio.jpg',
  Reinaldo: 'Reinaldo.jpg', Rodrigo: 'Rodrigo.jpg', Tiago: 'Tiago.jpg',
};
const MECANICOS_PADRAO = Object.keys(FOTOS).sort((a, b) => a.localeCompare(b, 'pt-BR'));
const TIPOS = { 1: 'Tipo 1 · 1 pneu', 2: 'Tipo 2 · 2 pneus' };
const MODOS = { manual: 'manual', sinal: 'sinal', auto: 'automático' };
const SINAL_ATRASO_MIN = 1500, SINAL_ATRASO_MAX = 3500;

const $ = s => document.querySelector(s);
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('pitstop') : null;
const broadcast = msg => channel && channel.postMessage(msg);

// ---------- Dados ----------
function load() {
  let d;
  try { d = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch {}
  if (!d || !Array.isArray(d.tentativas)) d = { mecanicos: [...MECANICOS_PADRAO], tentativas: [] };
  // Garante que todos com retrato entram na lista (sem apagar nomes extras já cadastrados)
  const set = new Set([...(d.mecanicos || []), ...MECANICOS_PADRAO]);
  d.mecanicos = [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  d.equipes = d.equipes || [];
  d.sel = d.sel || {};
  d.auto = d.auto || {};
  return d;
}
let db = load();
function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  broadcast({ kind: 'data' });
}

const sel = Object.assign({ tipo: 1, modo: 'manual', pist: '', enc1: '', enc2: '', unico: false }, db.sel);

// ---------- Vídeos (IndexedDB) ----------
const idb = new Promise((resolve, reject) => {
  const req = indexedDB.open('pitstop-videos', 1);
  req.onupgradeneeded = () => req.result.createObjectStore('videos');
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
async function videoStore(mode, fn) {
  const tx = (await idb).transaction('videos', mode);
  const req = fn(tx.objectStore('videos'));
  return new Promise((res, rej) => { tx.oncomplete = () => res(req && req.result); tx.onerror = () => rej(tx.error); });
}
async function salvarVideo(id, blob) {
  await videoStore('readwrite', s => s.put(blob, id));
  const t = db.tentativas.find(x => x.id === id);
  if (t) { t.video = true; save(); renderAll(); }
}
async function abrirVideo(id) {
  const blob = await videoStore('readonly', s => s.get(id));
  if (!blob) { alert('Vídeo não encontrado.'); return; }
  const t = db.tentativas.find(x => x.id === id);
  $('#modalTitle').textContent = t ? `${fmt(t.ms)} s — ${equipeTxt(t)} — ${hora(t.ts)}` : '';
  const v = $('#modalVideo');
  URL.revokeObjectURL(v.src);
  v.src = URL.createObjectURL(blob);
  $('#modal').hidden = false;
  v.play();
}
$('#modalClose').addEventListener('click', () => { $('#modalVideo').pause(); $('#modal').hidden = true; });

// ---------- Utilidades ----------
const fmt = ms => (ms / 1000).toFixed(2).replace('.', ',');
const pad = n => String(n).padStart(2, '0');
const dayKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const hora = ts => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const hoje = () => dayKey(Date.now());
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function fotoSrc(nome) {
  const arq = FOTOS[nome];
  return arq ? 'membros/' + encodeURIComponent(arq) : '';
}
function iniciais(nome) {
  return String(nome || '?').split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase();
}
function avatar(nome, cls = '') {
  const src = fotoSrc(nome);
  if (src) return `<img class="avatar ${cls}" src="${src}" alt="${esc(nome)}" title="${esc(nome)}" loading="lazy">`;
  return `<span class="avatar avatar-fallback ${cls}" title="${esc(nome)}">${esc(iniciais(nome))}</span>`;
}
function avatarsEquipe(t, cls = '') {
  const nomes = [t.pist, t.enc1, t.enc2].filter(Boolean);
  return `<span class="avatars ${cls}">${nomes.map(n => avatar(n)).join('')}</span>`;
}

function encaixadores(t) { return t.enc2 ? [t.enc1, t.enc2] : [t.enc1]; }
function funcoesTxt(t) {
  if (t.tipo === 1) return `P: ${t.pist} · E: ${t.enc1}`;
  return t.enc2 ? `P: ${t.pist} · E1: ${t.enc1} · E2: ${t.enc2}` : `P: ${t.pist} · E: ${t.enc1} (único)`;
}
function equipeTxt(t) { return t.nome ? `${t.nome} (${funcoesTxt(t)})` : funcoesTxt(t); }
function tentativasDoDia(dia, tipo) {
  return db.tentativas.filter(t => dayKey(t.ts) === dia && (tipo == null || t.tipo === tipo));
}
function ranking(dia, tipo) {
  return tentativasDoDia(dia, tipo).filter(t => t.valida).sort((a, b) => a.ms - b.ms);
}

function salvarTentativa(dados) {
  const melhorAntes = ranking(hoje(), dados.tipo)[0];
  const t = { id: Date.now() + '-' + Math.random().toString(36).slice(2, 6), ts: Date.now(), nome: '', enc2: '', valida: true, obs: '', ...dados };
  db.tentativas.push(t);
  save();
  const recorde = t.valida && (!melhorAntes || t.ms < melhorAntes.ms);
  broadcast({ kind: 'stop', ms: t.ms, recorde });
  renderAll();
  return { t, recorde, melhorAntes };
}

let audioCtx;
function beep(freq = 1000, dur = 0.35) {
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.frequency.value = freq; o.type = 'square';
  g.gain.setValueAtTime(0.4, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
  o.connect(g).connect(audioCtx.destination);
  o.start(); o.stop(audioCtx.currentTime + dur);
}

// ---------- Abas ----------
const abaAtiva = () => document.querySelector('main section.active').id;
document.querySelectorAll('nav button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('nav button').forEach(x => x.classList.toggle('active', x === b));
  document.querySelectorAll('main section').forEach(s => s.classList.toggle('active', s.id === b.dataset.tab));
  renderAll();
}));

// ---------- Cronômetro manual: seleção ----------
function fillSelect(el, value, vazio = '— escolher —') {
  el.innerHTML = `<option value="">${vazio}</option>` +
    db.mecanicos.map(m => `<option value="${esc(m)}" ${m === value ? 'selected' : ''}>${esc(m)}</option>`).join('');
}
function facePicker(containerId, selectId, { allowEmpty = false } = {}) {
  const box = $(containerId);
  if (!box) return;
  const cur = $(selectId).value;
  box.dataset.allowEmpty = allowEmpty ? '1' : '';
  box.innerHTML = (allowEmpty
    ? `<button type="button" class="face ${cur === '' ? 'on' : ''}" data-nome="" title="Nenhum"><span class="avatar avatar-fallback sm">—</span><span class="face-name">Nenhum</span></button>`
    : '') +
    db.mecanicos.map(m => `<button type="button" class="face ${m === cur ? 'on' : ''}" data-nome="${esc(m)}" title="${esc(m)}">${avatar(m)}<span class="face-name">${esc(m)}</span></button>`).join('');
}
function bindFacePicker(containerId, selectId) {
  $(containerId)?.addEventListener('click', e => {
    const btn = e.target.closest('.face');
    if (!btn) return;
    $(selectId).value = btn.dataset.nome;
    $(selectId).dispatchEvent(new Event('change'));
    facePicker(containerId, selectId, { allowEmpty: $(containerId).dataset.allowEmpty === '1' });
  });
}
function renderSelecao() {
  document.querySelectorAll('#tipoSeg button').forEach(b => b.classList.toggle('active', +b.dataset.tipo === sel.tipo));
  document.querySelectorAll('#modoSeg button').forEach(b => b.classList.toggle('active', b.dataset.modo === sel.modo));
  fillSelect($('#selPist'), sel.pist);
  fillSelect($('#selEnc1'), sel.enc1);
  fillSelect($('#selEnc2'), sel.enc2);
  facePicker('#facesPist', '#selPist');
  facePicker('#facesEnc1', '#selEnc1');
  facePicker('#facesEnc2', '#selEnc2');
  const t2 = sel.tipo === 2;
  $('#wrapUnico').style.display = t2 ? '' : 'none';
  $('#wrapEnc2').style.display = t2 && !sel.unico ? '' : 'none';
  $('#lblEnc1').textContent = t2 && !sel.unico ? 'Encaixador 1' : 'Encaixador';
  $('#chkUnico').checked = sel.unico;
  $('#hint').textContent = sel.modo === 'manual'
    ? 'Toque em INICIAR no primeiro movimento do pistoleiro e em PARAR quando ele levantar o braço. Atalhos: barra de espaço ou passador de slides.'
    : 'Toque em PREPARAR: após um intervalo aleatório soa o bipe e o tempo começa. Toque em PARAR quando o pistoleiro levantar o braço.';
}
function persistSel() { db.sel = { ...sel }; save(); }

$('#tipoSeg').addEventListener('click', e => { if (e.target.dataset.tipo && timer.estado === 'pronto') { sel.tipo = +e.target.dataset.tipo; persistSel(); renderAll(); } });
$('#modoSeg').addEventListener('click', e => { if (e.target.dataset.modo && timer.estado === 'pronto') { sel.modo = e.target.dataset.modo; persistSel(); renderAll(); } });
$('#selPist').addEventListener('change', e => { sel.pist = e.target.value; persistSel(); });
$('#selEnc1').addEventListener('change', e => { sel.enc1 = e.target.value; persistSel(); });
$('#selEnc2').addEventListener('change', e => { sel.enc2 = e.target.value; persistSel(); });
$('#chkUnico').addEventListener('change', e => { sel.unico = e.target.checked; persistSel(); renderSelecao(); });

function equipeAtual() {
  const enc2 = sel.tipo === 2 && !sel.unico ? sel.enc2 : '';
  return { tipo: sel.tipo, pist: sel.pist, enc1: sel.enc1, enc2 };
}
function validarFuncoes(e, exigeEnc2) {
  if (!e.pist) return 'Escolha o pistoleiro.';
  if (!e.enc1) return 'Escolha o encaixador.';
  if (exigeEnc2 && !e.enc2) return 'Escolha o encaixador 2 ou marque "Encaixador único".';
  const nomes = [e.pist, e.enc1, e.enc2].filter(Boolean);
  if (new Set(nomes).size !== nomes.length) return 'O mesmo mecânico está em duas funções.';
  return null;
}

// ---------- Cronômetro manual ----------
const timer = { estado: 'pronto', t0: 0, raf: 0, timeout: 0 };

function setDisplay(txt, cls) {
  const d = $('#timerDisplay');
  d.textContent = txt;
  d.className = cls || '';
}
function tick() {
  setDisplay(fmt(performance.now() - timer.t0), 'running');
  timer.raf = requestAnimationFrame(tick);
}
function iniciarContagem() {
  timer.estado = 'correndo';
  timer.t0 = performance.now();
  broadcast({ kind: 'start', at: Date.now(), equipe: equipeTxt(equipeAtual()), tipo: sel.tipo });
  $('#bigBtn').textContent = 'PARAR';
  $('#bigBtn').className = 'bigBtn stop';
  $('#timerStatus').textContent = 'Cronometrando…';
  tick();
}
function acionar() {
  if (timer.estado === 'pronto') {
    const erro = validarFuncoes(equipeAtual(), sel.tipo === 2 && !sel.unico);
    if (erro) { $('#timerStatus').textContent = erro; return; }
    $('#lastBox').style.display = 'none';
    if (sel.modo === 'manual') { iniciarContagem(); return; }
    timer.estado = 'armado';
    beep(600, 0.12);
    setDisplay('PRONTOS', 'armed');
    $('#bigBtn').textContent = 'CANCELAR';
    $('#bigBtn').className = 'bigBtn armed';
    $('#timerStatus').textContent = 'Aguarde o bipe…';
    const atraso = SINAL_ATRASO_MIN + Math.random() * (SINAL_ATRASO_MAX - SINAL_ATRASO_MIN);
    timer.timeout = setTimeout(() => { beep(1200, 0.4); iniciarContagem(); }, atraso);
  } else if (timer.estado === 'armado') {
    clearTimeout(timer.timeout);
    resetBotao();
    setDisplay('0,00');
    $('#timerStatus').textContent = 'Cancelado.';
  } else if (timer.estado === 'correndo') {
    const ms = Math.round(performance.now() - timer.t0);
    cancelAnimationFrame(timer.raf);
    registrarManual(ms);
  }
}
function resetBotao() {
  timer.estado = 'pronto';
  $('#bigBtn').textContent = sel.modo === 'manual' ? 'INICIAR' : 'PREPARAR';
  $('#bigBtn').className = 'bigBtn';
}
function registrarManual(ms) {
  resetBotao();
  const { t, recorde, melhorAntes } = salvarTentativa({ ...equipeAtual(), ms, modo: sel.modo });
  setDisplay(fmt(ms), recorde ? 'record' : '');
  $('#timerStatus').innerHTML = recorde ? '<span class="badge rec">MELHOR TEMPO DO DIA</span>' : `Melhor do dia: ${fmt(melhorAntes.ms)} s`;
  mostrarUltima(t);
}
function mostrarUltima(t) {
  const box = $('#lastBox');
  box.style.display = 'flex';
  box.innerHTML = `<span>Última: <b>${fmt(t.ms)} s</b> — ${esc(equipeTxt(t))}</span>
    <button class="btn small danger" data-act="invalidar">Invalidar (erro)</button>
    <button class="btn small" data-act="excluir">Excluir (toque errado)</button>`;
  box.onclick = ev => {
    const act = ev.target.dataset.act;
    if (act === 'invalidar') { invalidar(t.id); box.style.display = 'none'; }
    if (act === 'excluir') { excluir(t.id, true); box.style.display = 'none'; setDisplay('0,00'); $('#timerStatus').textContent = 'Tentativa excluída.'; }
  };
}

$('#bigBtn').addEventListener('pointerdown', e => { e.preventDefault(); acionar(); });
const TECLAS = ['Space', 'Enter', 'NumpadEnter', 'PageDown', 'PageUp', 'ArrowRight', 'ArrowLeft', 'MediaPlayPause', 'AudioVolumeUp'];
document.addEventListener('keydown', e => {
  if (document.body.classList.contains('tv') || !$('#modal').hidden) return;
  if (!TECLAS.includes(e.code) && !TECLAS.includes(e.key) || e.repeat) return;
  const tag = document.activeElement.tagName;
  if (tag === 'INPUT' && e.code !== 'Space') return;
  const aba = abaAtiva();
  if (aba !== 'cronometro' && aba !== 'automatico') return;
  e.preventDefault();
  document.activeElement.blur();
  if (aba === 'cronometro') acionar(); else auto.pronto();
});

// ---------- Ações sobre tentativas ----------
function invalidar(id) {
  const t = db.tentativas.find(x => x.id === id);
  if (!t) return;
  if (t.valida) {
    const motivo = prompt('Motivo da invalidação (ex.: porca não apertada, pneu caiu):', '');
    if (motivo === null) return;
    t.valida = false; t.obs = motivo;
  } else {
    t.valida = true; t.obs = '';
  }
  save(); renderAll();
}
function excluir(id, semConfirmar) {
  if (!semConfirmar && !confirm('Excluir esta tentativa definitivamente?')) return;
  db.tentativas = db.tentativas.filter(x => x.id !== id);
  videoStore('readwrite', s => s.delete(id));
  save(); renderAll();
}

// ---------- Ranking ----------
function champCard(dia, tipo) {
  const r = ranking(dia, tipo);
  const total = tentativasDoDia(dia, tipo).length;
  if (!r.length) return `<div class="card champ"><h2>Mais rápido · ${TIPOS[tipo]}</h2><div class="empty">Nenhuma tentativa válida.</div></div>`;
  const b = r[0];
  const media = r.reduce((s, t) => s + t.ms, 0) / r.length;
  return `<div class="card champ"><h2>Mais rápido · ${TIPOS[tipo]}</h2>
    <div class="champ-top">${avatarsEquipe(b, 'lg')}<div class="time">${fmt(b.ms)} s</div></div>
    <div class="team">${esc(equipeTxt(b))}</div>
    <div class="meta">às ${hora(b.ts)} · ${r.length} válidas de ${total} · média do dia ${fmt(media)} s
    ${b.video ? `<button class="btn small" data-video="${b.id}">Ver vídeo</button>` : ''}</div></div>`;
}
function rankTable(dia, tipo, limite) {
  const r = ranking(dia, tipo).slice(0, limite || 999);
  if (!r.length) return '<div class="empty">Sem tentativas.</div>';
  return `<table><tr><th>#</th><th>Tempo</th><th>Equipe</th><th>Hora</th></tr>` +
    r.map((t, i) => `<tr class="${i === 0 ? 'pos1' : ''}"><td>${i + 1}º</td><td class="num">${fmt(t.ms)}</td>
      <td><div class="who">${avatarsEquipe(t)}<span>${esc(equipeTxt(t))}</span></div></td><td>${hora(t.ts)}</td></tr>`).join('') +
    `</table>`;
}
function mecStats(dia) {
  const rows = db.mecanicos.map(m => {
    const cel = tipo => {
      const r = ranking(dia, tipo).filter(t => t.pist === m || encaixadores(t).includes(m));
      if (!r.length) return '<td>—</td><td>—</td><td>0</td>';
      const media = r.reduce((s, t) => s + t.ms, 0) / r.length;
      return `<td class="num">${fmt(r[0].ms)}</td><td class="num">${fmt(media)}</td><td>${r.length}</td>`;
    };
    return `<tr><td><div class="who">${avatar(m)}<span>${esc(m)}</span></div></td>${cel(1)}${cel(2)}</tr>`;
  }).join('');
  return `<table><tr><th>Mecânico</th><th>Melhor T1</th><th>Média T1</th><th>Qtd T1</th><th>Melhor T2</th><th>Média T2</th><th>Qtd T2</th></tr>${rows}</table>`;
}
function renderRanking() {
  const dia = $('#rankDate').value || hoje();
  $('#champs').innerHTML = champCard(dia, 1) + champCard(dia, 2);
  $('#rankTables').innerHTML = [1, 2].map(tp => `<div class="card"><h2>Ranking · ${TIPOS[tp]}</h2>${rankTable(dia, tp)}</div>`).join('');
  $('#mecStats').innerHTML = mecStats(dia);
}
$('#rankDate').addEventListener('change', renderRanking);
$('#rankToday').addEventListener('click', () => { $('#rankDate').value = hoje(); renderRanking(); });
$('#champs').addEventListener('click', e => { if (e.target.dataset.video) abrirVideo(e.target.dataset.video); });

function renderCronoSide() {
  const dia = hoje();
  $('#cronoSide').innerHTML = [1, 2].map(tp =>
    `<div class="card"><h2>Top 5 hoje · ${TIPOS[tp]}</h2>${rankTable(dia, tp, 5)}</div>`).join('');
}

// ---------- Histórico ----------
function histLista() {
  const lista = $('#histAll').checked ? db.tentativas : tentativasDoDia($('#histDate').value || hoje());
  return [...lista].sort((a, b) => b.ts - a.ts);
}
function renderHistorico() {
  const lista = histLista();
  if (!lista.length) { $('#histTable').innerHTML = '<div class="empty">Nenhuma tentativa.</div>'; return; }
  $('#histTable').innerHTML = `<table><tr><th>Data</th><th>Hora</th><th>Tipo</th><th>Equipe</th><th>Tempo</th><th>Início</th><th>Obs.</th><th></th></tr>` +
    lista.map(t => `<tr class="${t.valida ? '' : 'invalid'}">
      <td>${dayKey(t.ts).split('-').reverse().join('/')}</td><td>${hora(t.ts)}</td><td>${t.tipo}</td>
      <td><div class="who">${avatarsEquipe(t)}<span>${esc(equipeTxt(t))}</span></div></td><td class="num">${fmt(t.ms)}</td>
      <td><span class="badge">${MODOS[t.modo] || t.modo}</span></td>
      <td>${t.valida ? '' : '<span class="badge inv">inválida</span> '}${esc(t.obs)}</td>
      <td class="actions">${t.video ? `<button class="btn small" data-video="${t.id}">Vídeo</button> ` : ''}
      <button class="btn small" data-inv="${t.id}">${t.valida ? 'Invalidar' : 'Validar'}</button>
      <button class="btn small danger" data-del="${t.id}">Excluir</button></td></tr>`).join('') + `</table>`;
}
$('#histTable').addEventListener('click', e => {
  if (e.target.dataset.video) abrirVideo(e.target.dataset.video);
  if (e.target.dataset.inv) invalidar(e.target.dataset.inv);
  if (e.target.dataset.del) excluir(e.target.dataset.del);
});
$('#histDate').addEventListener('change', renderHistorico);
$('#histAll').addEventListener('change', renderHistorico);
$('#clearVideos').addEventListener('click', async () => {
  if (!confirm('Apagar TODOS os vídeos salvos? Os tempos são mantidos.')) return;
  await videoStore('readwrite', s => s.clear());
  db.tentativas.forEach(t => delete t.video);
  save(); renderAll();
});

function download(nome, conteudo, tipo) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  a.download = nome;
  a.click();
  URL.revokeObjectURL(a.href);
}
$('#exportCsv').addEventListener('click', () => {
  const linhas = [['Data', 'Hora', 'Tipo', 'Equipe', 'Pistoleiro', 'Encaixador 1', 'Encaixador 2', 'Tempo (s)', 'Válida', 'Início', 'Observação']];
  [...histLista()].reverse().forEach(t => linhas.push([
    dayKey(t.ts).split('-').reverse().join('/'), hora(t.ts), t.tipo, t.nome || '', t.pist, t.enc1, t.enc2 || '',
    fmt(t.ms), t.valida ? 'Sim' : 'Não', MODOS[t.modo] || t.modo, t.obs || ''
  ]));
  const csv = '\ufeff' + linhas.map(l => l.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const sufixo = $('#histAll').checked ? 'completo' : ($('#histDate').value || hoje());
  download(`pitstop_${sufixo}.csv`, csv, 'text/csv;charset=utf-8');
});
$('#exportJson').addEventListener('click', () => download(`pitstop_backup_${hoje()}.json`, JSON.stringify(db, null, 2), 'application/json'));
$('#importJson').addEventListener('change', async e => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!Array.isArray(d.tentativas)) throw new Error();
    if (!confirm(`Restaurar backup com ${d.tentativas.length} tentativas? Os dados atuais serão substituídos.`)) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
    db = load(); save(); renderAll();
  } catch { alert('Arquivo de backup inválido.'); }
  e.target.value = '';
});

// ---------- Mecânicos e equipes ----------
function renderMecanicos() {
  $('#mecList').innerHTML = db.mecanicos.map(m =>
    `<span class="chip chip-foto">${avatar(m)}<span>${esc(m)}</span>${FOTOS[m] ? '' : `<button data-rm="${esc(m)}" title="Remover">✕</button>`}</span>`
  ).join('') || '<div class="empty">Nenhum mecânico cadastrado.</div>';
  const keep = id => $(id).value;
  const [p, e1, e2] = [keep('#eqPist'), keep('#eqEnc1'), keep('#eqEnc2')];
  fillSelect($('#eqPist'), p);
  fillSelect($('#eqEnc1'), e1);
  fillSelect($('#eqEnc2'), e2, '— nenhum (único) —');
  facePicker('#eqFacesPist', '#eqPist');
  facePicker('#eqFacesEnc1', '#eqEnc1');
  facePicker('#eqFacesEnc2', '#eqEnc2', { allowEmpty: true });
  const t2 = $('#eqTipo').value === '2';
  $('#eqWrapEnc2').style.display = t2 ? '' : 'none';
  $('#eqHint').style.display = t2 ? '' : 'none';
  $('#eqLblEnc1').textContent = t2 ? 'Encaixador 1' : 'Encaixador';
  $('#eqList').innerHTML = db.equipes.length
    ? `<table><tr><th>Equipe</th><th>Tipo</th><th>Funções</th><th></th></tr>` +
      db.equipes.map(q => `<tr><td><div class="who">${avatarsEquipe(q)}<b>${esc(q.nome)}</b></div></td><td>${TIPOS[q.tipo]}</td><td>${esc(funcoesTxt(q))}</td>
        <td class="actions"><button class="btn small danger" data-rmeq="${q.id}">Remover</button></td></tr>`).join('') + `</table>`
    : '<div class="empty">Nenhuma equipe criada. As equipes aparecem como botões na tela Automático.</div>';
}
$('#eqTipo').addEventListener('change', renderMecanicos);
$('#eqAdd').addEventListener('click', () => {
  const tipo = +$('#eqTipo').value;
  const q = { tipo, pist: $('#eqPist').value, enc1: $('#eqEnc1').value, enc2: tipo === 2 ? $('#eqEnc2').value : '' };
  const nome = $('#eqNome').value.trim();
  const erro = !nome ? 'Dê um nome à equipe.' : validarFuncoes(q, false);
  if (erro) { alert(erro); return; }
  db.equipes.push({ id: 'eq' + Date.now(), nome, ...q });
  $('#eqNome').value = '';
  save(); renderAll();
});
$('#eqList').addEventListener('click', e => {
  const id = e.target.dataset.rmeq;
  if (id && confirm('Remover esta equipe? (As tentativas registradas são mantidas.)')) {
    db.equipes = db.equipes.filter(q => q.id !== id);
    save(); renderAll();
  }
});
function addMec() {
  const nome = $('#newMec').value.trim();
  if (!nome || db.mecanicos.includes(nome)) return;
  db.mecanicos.push(nome);
  db.mecanicos.sort((a, b) => a.localeCompare(b, 'pt-BR'));
  $('#newMec').value = '';
  save(); renderAll();
}
$('#addMec').addEventListener('click', addMec);
$('#newMec').addEventListener('keydown', e => { if (e.key === 'Enter') addMec(); });
$('#mecList').addEventListener('click', e => {
  const m = e.target.dataset.rm;
  if (m && confirm(`Remover ${m} da lista? (As tentativas registradas são mantidas.)`)) {
    db.mecanicos = db.mecanicos.filter(x => x !== m);
    save(); renderAll();
  }
});

// ---------- Modo TV ----------
const isTv = new URLSearchParams(location.search).has('tv');
$('#openTv').addEventListener('click', () => window.open(location.pathname + '?tv=1', 'pitstop-tv'));
$('#tvExit').addEventListener('click', () => window.close());

const tvLive = { raf: 0, at: 0 };
function renderTvBoards() {
  const dia = hoje();
  $('#tvBoards').innerHTML = [1, 2].map(tp => {
    const r = ranking(dia, tp);
    const lider = r[0] ? `<div class="champ" style="padding:12px;border-radius:12px;margin-bottom:12px">
        <div class="champ-top">${avatarsEquipe(r[0], 'lg')}<div class="time">${fmt(r[0].ms)} s</div></div>
        <div class="team">${esc(equipeTxt(r[0]))}</div></div>` : '';
    return `<div class="card"><h2>${TIPOS[tp]}</h2>${lider}${rankTable(dia, tp, 5)}</div>`;
  }).join('');
}
function tvTick() {
  $('#tvTimer').textContent = fmt(Math.max(0, Date.now() - tvLive.at));
  tvLive.raf = requestAnimationFrame(tvTick);
}
if (channel) channel.onmessage = ({ data }) => {
  if (data.kind === 'data') { db = load(); renderAll(); }
  if (!isTv) return;
  if (data.kind === 'start') {
    tvLive.at = data.at;
    $('#tvLabel').textContent = TIPOS[data.tipo];
    $('#tvTeam').textContent = data.equipe;
    $('#tvTimer').className = 'running';
    cancelAnimationFrame(tvLive.raf); tvTick();
  }
  if (data.kind === 'cancel') {
    cancelAnimationFrame(tvLive.raf);
    $('#tvTimer').textContent = '0,00';
    $('#tvTimer').className = '';
    $('#tvLabel').textContent = data.motivo || 'Aguardando tentativa';
  }
  if (data.kind === 'stop') {
    cancelAnimationFrame(tvLive.raf);
    $('#tvTimer').textContent = fmt(data.ms);
    $('#tvTimer').className = data.recorde ? 'record' : '';
    $('#tvLabel').textContent = data.recorde ? 'NOVO MELHOR TEMPO DO DIA!' : 'Tempo final';
  }
};
window.addEventListener('storage', e => { if (e.key === STORAGE_KEY) { db = load(); renderAll(); } });

// ---------- Inicialização ----------
const auto = initAuto({
  db: () => db, save, salvarTentativa, salvarVideo, equipeTxt, funcoesTxt, fmt, esc, broadcast, TIPOS,
  avatar, avatarsEquipe,
});

bindFacePicker('#facesPist', '#selPist');
bindFacePicker('#facesEnc1', '#selEnc1');
bindFacePicker('#facesEnc2', '#selEnc2');
bindFacePicker('#eqFacesPist', '#eqPist');
bindFacePicker('#eqFacesEnc1', '#eqEnc1');
bindFacePicker('#eqFacesEnc2', '#eqEnc2');

function renderAll() {
  if (isTv) { renderTvBoards(); return; }
  renderSelecao();
  if (timer.estado === 'pronto') resetBotao();
  renderCronoSide();
  renderRanking();
  renderHistorico();
  renderMecanicos();
  auto.render();
}
if (isTv) document.body.classList.add('tv');
$('#rankDate').value = hoje();
$('#histDate').value = hoje();
save(); // persiste a lista completa de mecânicos com retrato
renderAll();
