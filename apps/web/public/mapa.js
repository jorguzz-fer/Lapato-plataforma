/*
  Mapa dos Módulos — abas e marcações da homologação.

  Fica em arquivo próprio porque a CSP de produção (`infra/nginx-seguranca.conf`)
  traz `script-src 'self'`: script inline seria recusado em silêncio e a página
  abriria sem abas. Nada aqui fala com a API; o estado da homologação vive só
  no localStorage de quem marca.
*/
(function () {
  'use strict';

  /* ---------- abas: a escolhida vai no hash, para o link ser compartilhável ---------- */

  var abas = Array.prototype.slice.call(document.querySelectorAll('.aba[data-aba]'));
  var nomes = abas.map(function (b) { return b.dataset.aba; });

  function mostrar(nome, focar) {
    if (nomes.indexOf(nome) < 0) nome = nomes[0];
    abas.forEach(function (b) {
      var ativa = b.dataset.aba === nome;
      b.setAttribute('aria-selected', ativa ? 'true' : 'false');
      b.tabIndex = ativa ? 0 : -1;
      var painel = document.getElementById('painel-' + b.dataset.aba);
      if (painel) painel.hidden = !ativa;
      if (ativa && focar) b.focus();
    });
  }

  abas.forEach(function (b, i) {
    b.addEventListener('click', function () {
      if (history.replaceState) history.replaceState(null, '', '#' + b.dataset.aba);
      mostrar(b.dataset.aba, false);
    });
    b.addEventListener('keydown', function (ev) {
      var alvo = null;
      if (ev.key === 'ArrowRight') alvo = abas[(i + 1) % abas.length];
      if (ev.key === 'ArrowLeft') alvo = abas[(i - 1 + abas.length) % abas.length];
      if (ev.key === 'Home') alvo = abas[0];
      if (ev.key === 'End') alvo = abas[abas.length - 1];
      if (!alvo) return;
      ev.preventDefault();
      if (history.replaceState) history.replaceState(null, '', '#' + alvo.dataset.aba);
      mostrar(alvo.dataset.aba, true);
    });
  });

  window.addEventListener('hashchange', function () { mostrar(location.hash.replace('#', ''), false); });
  mostrar(location.hash.replace('#', ''), false);

  /* ---------- homologação: resultado e observação por cenário, neste navegador ---------- */

  var CHAVE = 'lapato-homologacao-v1';
  var estado = {};
  try { estado = JSON.parse(localStorage.getItem(CHAVE) || '{}') || {}; } catch (e) { estado = {}; }

  var cenarios = Array.prototype.slice.call(document.querySelectorAll('.cenario'));
  if (!cenarios.length) return;

  function salvar() { try { localStorage.setItem(CHAVE, JSON.stringify(estado)); } catch (e) { /* sem storage: a marcação vale só até recarregar */ } }

  function contar() {
    var c = { ok: 0, falhou: 0, bloqueado: 0, pendente: 0 };
    cenarios.forEach(function (el) {
      var v = (estado[el.dataset.id] || {}).r || '';
      if (c[v] !== undefined) c[v]++; else c.pendente++;
    });
    Object.keys(c).forEach(function (k) {
      var b = document.querySelector('[data-conta="' + k + '"]');
      if (b) b.textContent = c[k];
    });
    var badge = document.querySelector('#aba-homologacao .badge');
    if (badge) badge.textContent = c.pendente === cenarios.length ? cenarios.length + ' cenários' : (cenarios.length - c.pendente) + '/' + cenarios.length + ' marcados';
  }

  cenarios.forEach(function (el) {
    var id = el.dataset.id, sel = el.querySelector('select'), obs = el.querySelector('input');
    var g = estado[id] || {};
    if (g.r) { sel.value = g.r; el.dataset.estado = g.r; }
    if (g.o) { obs.value = g.o; }
    sel.addEventListener('change', function () {
      estado[id] = estado[id] || {};
      estado[id].r = sel.value;
      if (sel.value) el.dataset.estado = sel.value; else delete el.dataset.estado;
      salvar(); contar();
    });
    obs.addEventListener('input', function () {
      estado[id] = estado[id] || {};
      estado[id].o = obs.value;
      salvar();
    });
  });

  var limpar = document.getElementById('limpar');
  if (limpar) limpar.addEventListener('click', function () {
    if (!window.confirm('Apagar todas as marcações deste navegador?')) return;
    estado = {}; salvar();
    cenarios.forEach(function (el) {
      el.querySelector('select').value = '';
      el.querySelector('input').value = '';
      delete el.dataset.estado;
    });
    contar();
  });

  contar();
})();
