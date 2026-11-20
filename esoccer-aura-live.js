'use strict';
(() => {
  const ROOT = './live-data-v2/esoccer-fc27/';
  const statusEl = document.getElementById('aura-live-status');
  const metricsEl = document.getElementById('aura-live-metrics');
  const listEl = document.getElementById('aura-live-list');
  if (!statusEl || !metricsEl || !listEl) return;
  const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const date = v => v ? new Date(v).toLocaleString('sk-SK') : '—';
  async function load() {
    try {
      const [sr, mr] = await Promise.all([
        fetch(ROOT + 'aura-status.json?v=' + Date.now(), {cache:'no-store'}),
        fetch(ROOT + 'aura-live.json?v=' + Date.now(), {cache:'no-store'})
      ]);
      if (!sr.ok) throw new Error('Čakám na prvý beh GitHub zberača.');
      const s = await sr.json();
      const m = mr.ok ? await mr.json() : {matches:[]};
      const matches = Array.isArray(m.matches) ? m.matches : [];
      const stale = !s.checked_at || Date.now() - new Date(s.checked_at).getTime() > 12 * 60 * 1000;
      const state = !s.checked_at ? 'ČAKÁ NA PRVÝ BEH' : stale ? 'ONESKORENÉ' : s.state === 'ok' ? 'FEED PRIPOJENÝ' : s.state === 'no_matching_events' ? 'BEZ eSOCCER ZÁPASOV' : 'CHYBA ZDROJA';
      statusEl.innerHTML = '<b>' + state + '</b> · ' + esc(s.message || '') +
        '<br><span style="color:#91a2b8">Posledná kontrola: ' + date(s.checked_at) +
        ' · Feed udalosti: ' + Number(s.feed_events || 0) +
        ' · eSoccer zápasy: ' + Number(s.esoccer_events || 0) +
        (s.error ? ' · ' + esc(s.error) : '') + '</span>';
      metricsEl.textContent = matches.length + ' živých záznamov · zdroj: ' + esc(s.source || 'AURA');
      listEl.innerHTML = matches.length ? matches.slice(0,30).map(x =>
        '<div class="es-match"><div><b>' + esc(x.home) + '</b><br><small>' + esc(x.away) +
        '</small><br><span class="es-pill">' + esc(x.league) + '</span></div><div class="es-score">' +
        (x.home_goals ?? '—') + ' : ' + (x.away_goals ?? '—') + '</div></div>'
      ).join('') : '<p class="es-note">Zatiaľ nebol potvrdený žiadny live eSoccer zápas. Panel zobrazuje skutočný stav zdroja, nie demo dáta.</p>';
    } catch (e) {
      statusEl.textContent = 'Čakám na prvý beh AURA zberača: ' + e.message;
      metricsEl.textContent = 'Zatiaľ bez potvrdených dát';
      listEl.innerHTML = '<p class="es-note">Po prvom spustení GitHub Actions sa tu zobrazí výsledok kontroly.</p>';
    }
  }
  load();
  setInterval(load, 60000);
})();
