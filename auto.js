import { FilesetResolver, PoseLandmarker } from './vendor/mediapipe/vision_bundle.mjs';

const DEFAULTS = {
  camId: '', micId: '', model: 'lite', arm: 'cabeca', hold: 3, minS: 1.5, maxS: 20,
  delayMin: 1.5, delayMax: 3.5, rearmS: 0, offsetMs: 0, clips: true,
  gunCheck: true, gunThr: 45, roi: null, ref: null, showRef: true, equipeId: '',
};
const GUN_BAND_HZ = [2000, 8000];
const GUN_MIN_TICKS = 3;          // ticks de 20 ms acima do limite = pistola
const GUN_IGNORE_AFTER_BEEP = 600; // o próprio bipe não conta como pistola
const START_BEEP_HZ = 880;         // abaixo da banda da pistola

// Índices do MediaPipe Pose
const L_SHOULDER = 11, R_SHOULDER = 12, L_WRIST = 15, R_WRIST = 16, L_HIP = 23, R_HIP = 24;

export function initAuto(api) {
  const $ = s => document.querySelector(s);
  const video = $('#autoVideo'), canvas = $('#autoCanvas'), ctx2d = canvas.getContext('2d');

  let C = Object.assign({}, DEFAULTS, api.db().auto);
  const saveCfg = () => { api.db().auto = C; api.save(); };

  const S = {
    stream: null, micStream: null, landmarker: null, modelName: '', running: false,
    estado: 'desligado', t0: 0, delayTimer: 0, rearmTimer: 0, raf: 0, mpTs: 0,
    sawDown: false, upFrames: 0, firstUpTs: 0, gunHeard: false, gunRun: 0,
    poses: [], pose: null, armUp: false, micLevel: 0, micTimer: 0, actx: null,
    recorder: null, refImg: null, refSrc: null, drawing: null, msg: '',
  };

  // ---------- Áudio ----------
  function actx() {
    S.actx = S.actx || new (window.AudioContext || window.webkitAudioContext)();
    if (S.actx.state === 'suspended') S.actx.resume();
    return S.actx;
  }
  // Retorna em quantos ms o som realmente sai do alto-falante.
  function beep(freq, dur, vol = 0.6) {
    const a = actx();
    const o = a.createOscillator(), g = a.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
    o.connect(g).connect(a.destination);
    o.start(); o.stop(a.currentTime + dur);
    return ((a.outputLatency || 0) + (a.baseLatency || 0)) * 1000;
  }

  async function ligarMic() {
    S.micStream?.getTracks().forEach(t => t.stop());
    S.micStream = null;
    try {
      S.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: C.micId ? { exact: C.micId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch { return; }
    const a = actx();
    const analyser = a.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0;
    a.createMediaStreamSource(S.micStream).connect(analyser);
    const buf = new Float32Array(analyser.frequencyBinCount);
    const binHz = a.sampleRate / analyser.fftSize;
    const lo = Math.floor(GUN_BAND_HZ[0] / binHz), hi = Math.min(buf.length - 1, Math.ceil(GUN_BAND_HZ[1] / binHz));
    clearInterval(S.micTimer);
    S.micTimer = setInterval(() => {
      analyser.getFloatFrequencyData(buf);
      let sum = 0;
      for (let i = lo; i <= hi; i++) sum += Math.max(buf[i], -120);
      const dB = sum / (hi - lo + 1);
      S.micLevel = Math.max(0, Math.min(100, (dB + 100) * 1.25));
      if (S.estado === 'correndo' && performance.now() - S.t0 > GUN_IGNORE_AFTER_BEEP) {
        if (S.micLevel >= C.gunThr) { if (++S.gunRun >= GUN_MIN_TICKS) S.gunHeard = true; }
        else S.gunRun = 0;
      }
      $('#micBar').style.width = S.micLevel + '%';
      $('#micBar').style.background = S.micLevel >= C.gunThr ? 'var(--red)' : 'var(--green)';
    }, 20);
  }

  // ---------- Câmera e detector ----------
  async function listarDispositivos() {
    const devs = await navigator.mediaDevices.enumerateDevices();
    const opt = (list, cur, nome) => '<option value="">Padrão do sistema</option>' + list.map((d, i) =>
      `<option value="${d.deviceId}" ${d.deviceId === cur ? 'selected' : ''}>${api.esc(d.label || `${nome} ${i + 1}`)}</option>`).join('');
    $('#cfgCam').innerHTML = opt(devs.filter(d => d.kind === 'videoinput'), C.camId, 'Câmera');
    $('#cfgMic').innerHTML = opt(devs.filter(d => d.kind === 'audioinput'), C.micId, 'Microfone');
  }

  async function carregarModelo() {
    if (S.landmarker && S.modelName === C.model) return;
    status('Carregando detector de postura…');
    S.landmarker?.close();
    S.landmarker = null;
    const fileset = await FilesetResolver.forVisionTasks('./vendor/mediapipe/wasm');
    const opts = delegate => ({
      baseOptions: { modelAssetPath: `./vendor/mediapipe/pose_landmarker_${C.model}.task`, delegate },
      runningMode: 'VIDEO', numPoses: 3,
      minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    });
    try { S.landmarker = await PoseLandmarker.createFromOptions(fileset, opts('GPU')); }
    catch { S.landmarker = await PoseLandmarker.createFromOptions(fileset, opts('CPU')); }
    S.modelName = C.model;
  }

  async function ligar() {
    desligar();
    actx();
    status('Abrindo câmera…');
    try {
      S.stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: C.camId ? { exact: C.camId } : undefined, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } },
      });
    } catch (e) {
      status('Não foi possível abrir a câmera: ' + e.message);
      return;
    }
    video.srcObject = S.stream;
    await video.play();
    $('#camOff').style.display = 'none';
    await ligarMic();
    await listarDispositivos();
    try { await carregarModelo(); }
    catch (e) { status('Erro ao carregar o detector: ' + e.message); return; }
    S.running = true;
    S.estado = 'aguardando';
    const fps = Math.round(S.stream.getVideoTracks()[0].getSettings().frameRate || 0);
    status(`Câmera ligada (${video.videoWidth}×${video.videoHeight}, ${fps} qps)${S.micStream ? '' : ' — sem microfone'}.`);
    agendarQuadro();
    render();
  }

  function desligar() {
    if (S.estado === 'armado' || S.estado === 'correndo') display('0,00');
    cancelar(true);
    S.running = false;
    S.estado = 'desligado';
    S.stream?.getTracks().forEach(t => t.stop());
    S.micStream?.getTracks().forEach(t => t.stop());
    S.stream = S.micStream = null;
    clearInterval(S.micTimer);
    video.srcObject = null;
    $('#camOff').style.display = '';
    ctx2d.clearRect(0, 0, canvas.width, canvas.height);
    render();
  }

  function agendarQuadro() {
    if (!S.running) return;
    if (video.requestVideoFrameCallback) {
      video.requestVideoFrameCallback((now, meta) => {
        const cap = meta.captureTime;
        processar(cap && Math.abs(cap - now) < 1000 ? cap : now);
        agendarQuadro();
      });
    } else {
      requestAnimationFrame(() => { processar(performance.now()); agendarQuadro(); });
    }
  }

  // ---------- Análise da postura ----------
  const visivel = l => l && (l.visibility ?? 1) > 0.5;
  const dentroRoi = (x, y) => !C.roi || (x >= C.roi.x && x <= C.roi.x + C.roi.w && y >= C.roi.y && y <= C.roi.y + C.roi.h);

  function escolherPistoleiro(poses) {
    let melhor = null, area = 0;
    for (const p of poses) {
      const hx = (p[L_HIP].x + p[R_HIP].x) / 2, hy = (p[L_HIP].y + p[R_HIP].y) / 2;
      const sx = (p[L_SHOULDER].x + p[R_SHOULDER].x) / 2, sy = (p[L_SHOULDER].y + p[R_SHOULDER].y) / 2;
      if (!dentroRoi(hx, hy) && !dentroRoi(sx, sy)) continue;
      const xs = p.map(l => l.x), ys = p.map(l => l.y);
      const a = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
      if (a > area) { area = a; melhor = p; }
    }
    return melhor;
  }

  // Linha de referência: cabeça estimada pelo tronco, pois o rosto pode estar de costas ou coberto.
  function linhaBraco(p) {
    const sy = Math.min(p[L_SHOULDER].y, p[R_SHOULDER].y);
    if (C.arm === 'ombro') return sy;
    const torso = Math.abs((p[L_HIP].y + p[R_HIP].y) / 2 - (p[L_SHOULDER].y + p[R_SHOULDER].y) / 2);
    return sy - torso * 0.45;
  }
  function bracoLevantado(p) {
    const linha = linhaBraco(p);
    return [p[L_WRIST], p[R_WRIST]].some(w => visivel(w) && w.y < linha);
  }

  function processar(ts) {
    if (!S.landmarker || video.readyState < 2) return;
    S.mpTs = Math.max(S.mpTs + 1, performance.now());
    let res;
    try { res = S.landmarker.detectForVideo(video, S.mpTs); } catch { return; }
    S.poses = res.landmarks || [];
    S.pose = escolherPistoleiro(S.poses);
    S.armUp = S.pose ? bracoLevantado(S.pose) : false;

    if (S.estado === 'correndo') {
      const el = ts - S.t0;
      if (!S.armUp) { S.sawDown = true; S.upFrames = 0; }
      else if (S.sawDown && el >= C.minS * 1000) {
        if (S.upFrames === 0) S.firstUpTs = ts;
        if (++S.upFrames >= C.hold) finalizar(S.firstUpTs - S.t0 + C.offsetMs);
      }
      if (S.estado === 'correndo' && el > C.maxS * 1000) cancelar(false, 'Tempo esgotado sem o braço levantado — tentativa descartada.');
    }
    desenhar();
    indicadores();
  }

  // ---------- Desenho ----------
  function desenhar() {
    const w = video.videoWidth, h = video.videoHeight;
    if (!w) return;
    if (canvas.width !== w) { canvas.width = w; canvas.height = h; }
    ctx2d.clearRect(0, 0, w, h);
    if (C.showRef && S.refImg?.complete) {
      ctx2d.globalAlpha = 0.35;
      ctx2d.drawImage(S.refImg, 0, 0, w, h);
      ctx2d.globalAlpha = 1;
    }
    const roi = S.drawing?.rect || C.roi;
    if (roi) {
      ctx2d.setLineDash([16, 10]);
      ctx2d.strokeStyle = '#ffcc00'; ctx2d.lineWidth = 4;
      ctx2d.strokeRect(roi.x * w, roi.y * h, roi.w * w, roi.h * h);
      ctx2d.setLineDash([]);
    }
    for (const p of S.poses) {
      const ehPist = p === S.pose;
      ctx2d.strokeStyle = ehPist ? '#22c55e' : 'rgba(180,180,180,.5)';
      ctx2d.lineWidth = ehPist ? 5 : 2;
      for (const { start, end } of PoseLandmarker.POSE_CONNECTIONS) {
        const a = p[start], b = p[end];
        if (!visivel(a) || !visivel(b)) continue;
        ctx2d.beginPath(); ctx2d.moveTo(a.x * w, a.y * h); ctx2d.lineTo(b.x * w, b.y * h); ctx2d.stroke();
      }
      if (!ehPist) continue;
      const y = linhaBraco(p) * h;
      const xs = p.map(l => l.x * w);
      ctx2d.strokeStyle = S.armUp ? '#ef4444' : '#ffcc00'; ctx2d.lineWidth = 2;
      ctx2d.beginPath(); ctx2d.moveTo(Math.min(...xs) - 40, y); ctx2d.lineTo(Math.max(...xs) + 40, y); ctx2d.stroke();
      for (const i of [L_WRIST, R_WRIST]) {
        if (!visivel(p[i])) continue;
        ctx2d.fillStyle = p[i].y * h < y ? '#ef4444' : '#ffcc00';
        ctx2d.beginPath(); ctx2d.arc(p[i].x * w, p[i].y * h, 12, 0, Math.PI * 2); ctx2d.fill();
      }
    }
  }

  function indicadores() {
    $('#indPist').classList.toggle('ok', !!S.pose);
    $('#indBraco').classList.toggle('ok', S.armUp);
    $('#indPistola').classList.toggle('ok', S.gunHeard);
  }

  // ---------- Fluxo da tentativa ----------
  const equipe = () => api.db().equipes.find(q => q.id === C.equipeId);
  const status = txt => { S.msg = txt; $('#autoStatus').textContent = txt; };
  function display(txt, cls = '') { const d = $('#autoDisplay'); d.textContent = txt; d.className = cls; }

  function pronto() {
    if (S.estado === 'armado') { cancelar(false, 'Cancelado.'); return; }
    if (S.estado === 'correndo') return;
    if (!S.running) { status('Ligue a câmera primeiro.'); return; }
    if (!equipe()) { status('Toque no nome da sua equipe.'); return; }
    clearTimeout(S.rearmTimer);
    S.estado = 'armado';
    beep(440, 0.15, 0.4);
    display('PRONTOS', 'armed');
    status('Posição! Aguarde o bipe…');
    const atraso = (C.delayMin + Math.random() * Math.max(0, C.delayMax - C.delayMin)) * 1000;
    S.delayTimer = setTimeout(largada, atraso);
    render();
  }

  function largada() {
    const eq = equipe();
    const lat = beep(START_BEEP_HZ, 0.5);
    S.t0 = performance.now() + lat;
    Object.assign(S, { estado: 'correndo', sawDown: false, upFrames: 0, gunHeard: false, gunRun: 0 });
    iniciarGravacao();
    api.broadcast({ kind: 'start', at: Date.now() + lat, equipe: api.equipeTxt(eq), tipo: eq.tipo });
    status('Valendo!');
    const tick = () => {
      if (S.estado !== 'correndo') return;
      display(api.fmt(Math.max(0, performance.now() - S.t0)), 'running');
      S.raf = requestAnimationFrame(tick);
    };
    tick();
    render();
  }

  function finalizar(ms) {
    cancelAnimationFrame(S.raf);
    S.estado = 'aguardando';
    const eq = equipe();
    const semPistola = C.gunCheck && S.micStream && !S.gunHeard;
    const { t, recorde, melhorAntes } = api.salvarTentativa({
      nome: eq.nome, tipo: eq.tipo, pist: eq.pist, enc1: eq.enc1, enc2: eq.enc2 || '',
      ms: Math.round(ms), modo: 'auto', valida: !semPistola, obs: semPistola ? 'Pistola não detectada' : '',
    });
    pararGravacao(t.id);
    beep(1320, 0.12, 0.4);
    display(api.fmt(t.ms), recorde ? 'record' : '');
    if (semPistola) status('Pistola não detectada — tentativa marcada como inválida (pode ser validada no Histórico).');
    else status(recorde ? 'MELHOR TEMPO DO DIA!' : `Melhor do dia: ${api.fmt(melhorAntes.ms)} s`);
    if (C.rearmS > 0) {
      S.rearmTimer = setTimeout(() => { if (S.estado === 'aguardando') pronto(); }, C.rearmS * 1000);
      status(S.msg + ` Próxima tentativa em ${C.rearmS} s.`);
    }
    render();
  }

  function cancelar(silencioso, motivo) {
    clearTimeout(S.delayTimer);
    clearTimeout(S.rearmTimer);
    cancelAnimationFrame(S.raf);
    const ativo = S.estado === 'armado' || S.estado === 'correndo';
    if (S.estado === 'correndo') pararGravacao(null);
    if (S.running) S.estado = 'aguardando';
    if (ativo && !silencioso) {
      display('0,00');
      status(motivo || '');
      api.broadcast({ kind: 'cancel', motivo });
    }
    render();
  }

  // ---------- Gravação ----------
  function iniciarGravacao() {
    if (!C.clips || !window.MediaRecorder || !S.stream) return;
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find(m => MediaRecorder.isTypeSupported(m));
    const chunks = [];
    const rec = new MediaRecorder(S.stream, { mimeType: mime, videoBitsPerSecond: 2500000 });
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    rec.chunks = chunks;
    rec.start();
    S.recorder = rec;
  }
  function pararGravacao(id) {
    const rec = S.recorder;
    if (!rec) return;
    S.recorder = null;
    setTimeout(() => {
      rec.onstop = () => { if (id && rec.chunks.length) api.salvarVideo(id, new Blob(rec.chunks, { type: rec.mimeType })); };
      rec.stop();
    }, id ? 1500 : 0);
  }

  // ---------- Zona do pistoleiro e enquadramento ----------
  const ponto = e => {
    const r = canvas.getBoundingClientRect();
    const vw = video.videoWidth, vh = video.videoHeight;
    const escala = Math.min(r.width / vw, r.height / vh);
    const ox = (r.width - vw * escala) / 2, oy = (r.height - vh * escala) / 2;
    const clamp = v => Math.max(0, Math.min(1, v));
    return { x: clamp((e.clientX - r.left - ox) / (vw * escala)), y: clamp((e.clientY - r.top - oy) / (vh * escala)) };
  };
  $('#roiDraw').addEventListener('click', () => {
    if (!S.running) { status('Ligue a câmera para desenhar a zona.'); return; }
    S.drawing = { rect: null };
    $('#videoWrap').classList.add('drawing');
    $('#roiDraw').classList.add('on');
    status('Arraste sobre a imagem para marcar a zona onde o pistoleiro trabalha.');
  });
  canvas.addEventListener('pointerdown', e => {
    if (!S.drawing) return;
    S.drawing.start = ponto(e);
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!S.drawing?.start) return;
    const a = S.drawing.start, b = ponto(e);
    S.drawing.rect = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
  });
  canvas.addEventListener('pointerup', () => {
    if (!S.drawing) return;
    if (S.drawing.rect && S.drawing.rect.w > 0.03 && S.drawing.rect.h > 0.03) { C.roi = S.drawing.rect; saveCfg(); status('Zona do pistoleiro salva.'); }
    S.drawing = null;
    $('#videoWrap').classList.remove('drawing');
    $('#roiDraw').classList.remove('on');
  });
  $('#roiClear').addEventListener('click', () => { C.roi = null; saveCfg(); status('Zona removida: a pessoa maior na imagem é tratada como pistoleiro.'); });
  $('#refSave').addEventListener('click', () => {
    if (!S.running) { status('Ligue a câmera para salvar o enquadramento.'); return; }
    const c = document.createElement('canvas');
    c.width = 640; c.height = Math.round(640 * video.videoHeight / video.videoWidth);
    c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
    C.ref = c.toDataURL('image/jpeg', 0.7);
    saveCfg();
    status('Enquadramento padrão salvo. Nos próximos treinos, alinhe a câmera até a imagem coincidir com o guia.');
  });

  // ---------- Configuração ----------
  const campos = {
    cfgModel: ['model', 'value'], cfgArm: ['arm', 'value'], cfgHold: ['hold', 'int'], cfgMinS: ['minS', 'num'],
    cfgMaxS: ['maxS', 'num'], cfgDelayMin: ['delayMin', 'num'], cfgDelayMax: ['delayMax', 'num'], cfgRearm: ['rearmS', 'num'],
    cfgOffset: ['offsetMs', 'num'], cfgClips: ['clips', 'check'], cfgGun: ['gunCheck', 'check'], cfgGunThr: ['gunThr', 'num'],
    cfgShowRef: ['showRef', 'check'],
  };
  for (const [id, [key, kind]] of Object.entries(campos)) {
    $('#' + id).addEventListener(kind === 'num' && id === 'cfgGunThr' ? 'input' : 'change', async e => {
      const el = e.target;
      C[key] = kind === 'check' ? el.checked : kind === 'int' ? parseInt(el.value, 10) || 1 : kind === 'num' ? parseFloat(el.value) || 0 : el.value;
      saveCfg();
      if (key === 'model' && S.running) { await carregarModelo(); status('Detector trocado.'); }
    });
  }
  $('#cfgCam').addEventListener('change', e => { C.camId = e.target.value; saveCfg(); if (S.running) ligar(); });
  $('#cfgMic').addEventListener('change', e => { C.micId = e.target.value; saveCfg(); if (S.running) ligarMic(); });
  $('#camStart').addEventListener('click', ligar);
  $('#camStop').addEventListener('click', () => { desligar(); status('Câmera desligada.'); });
  $('#autoBtn').addEventListener('pointerdown', e => { e.preventDefault(); pronto(); });
  $('#teamTiles').addEventListener('click', e => {
    const tile = e.target.closest('[data-eq]');
    if (!tile || S.estado === 'armado' || S.estado === 'correndo') return;
    C.equipeId = tile.dataset.eq;
    saveCfg();
    status('');
    display('0,00');
    render();
  });

  function render() {
    C = Object.assign({}, DEFAULTS, api.db().auto);
    for (const [id, [key, kind]] of Object.entries(campos)) {
      const el = $('#' + id);
      if (document.activeElement === el) continue;
      if (kind === 'check') el.checked = !!C[key]; else el.value = C[key];
    }
    $('#micThr').style.left = C.gunThr + '%';
    if (C.ref !== S.refSrc) {
      S.refSrc = C.ref;
      S.refImg = C.ref ? Object.assign(new Image(), { src: C.ref }) : null;
    }
    const eqs = api.db().equipes;
    $('#teamTiles').innerHTML = eqs.length
      ? eqs.map(q => `<button class="tile ${q.id === C.equipeId ? 'active' : ''}" data-eq="${q.id}">${api.esc(q.nome)}<small>${api.TIPOS[q.tipo]}</small></button>`).join('')
      : '<div class="empty">Crie as equipes na aba "Mecânicos e equipes".</div>';
    const eq = equipe();
    $('#autoTeam').innerHTML = eq ? `<b>${api.esc(eq.nome)}</b> · ${api.TIPOS[eq.tipo]}<br><small style="color:var(--muted)">${api.esc(api.funcoesTxt(eq))}</small>` : 'Toque no nome da sua equipe';
    const btn = $('#autoBtn');
    const estados = {
      desligado: ['LIGUE A CÂMERA', 'bigBtn busy'], aguardando: ['PRONTO', 'bigBtn'],
      armado: ['CANCELAR', 'bigBtn armed'], correndo: ['CRONOMETRANDO', 'bigBtn busy'],
    };
    [btn.textContent, btn.className] = estados[S.estado];
  }

  return { render, pronto };
}
