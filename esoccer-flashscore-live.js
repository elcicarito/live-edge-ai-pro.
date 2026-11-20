'use strict';
(() => {
  const root = './live-data-v2/esoccer-fc27/';
  const statusEl = document.getElementById('flashscore-esports-status');
  const metricsEl = document.getElementById('flashscore-esports-metrics');
  const listEl = document.getElementById('flashscore-esports-list');
  if (!statusEl || !metricsEl || !listEl) return;
  const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const date = v => v ? new Date(v).toLocaleString('sk-SK') : '—';
  async function load() {
    try {
      const [sr, mr] = await Promise.all([
        fetch(root + 'flashscore-status.json?v=' + Date.now(), {cache:'no-store'}),
        fetch(root + 'flashscore-live.json?v=' + Date.now(), {cache:'no-store'})
      ]);
      if (!sr.ok) throw new Error('Čaká sa na prvý GitHub Actions beh.');
      const s = await sr.json();
      const m = mr.ok ? await mr.json() : {matches:[]};
      const matches = Array.isArray(m.matches) ? m.matches : [];
      const stale = !s.checked_at || Date.now() - new Date(s.checked_at).getTime() > 12 * 60 * 1000;
      const label = !s.checked_at ? 'ČAKÁ NA PRVÝ BEH' : stale ? 'ONESKORENÉ' :
        s.state === 'ok' ? 'KANDIDÁTI NÁJDENÍ' :
        s.state === 'no_matching_events' ? 'FEED BEŽÍ · VOLTA NEPOTVRDENÁ' : 'CHYBA ZDROJA';
      statusEl.innerHTML = '<b>' + label + '</b> · ' + esc(s.message || '') +
        '<br><span style="color:#91a2b8">Kontrola: ' + date(s.checked_at) +
        ' · eSports live: ' + Number(s.feed_events || 0) +
        ' · kandidáti eSoccer: ' + Number(s.candidate_events || 0) +
        (s.error ? ' · ' + esc(s.error) : '') + '</span>';
      metricsEl.textContent = 'Zdroj: Flashscore · šport eSports (ID 36) · kontrola každých 5 minút';
      listEl.innerHTML = matches.length ? matches.map(x =>
        '<div class="es-match"><div><b>' + esc(x.home) + '</b><br><small>' + esc(x.away) +
        '</small><br><span class="es-pill">' + esc(x.competition || 'eSports') + '</span></div><div class="es-score">' +
        (x.home_score ?? '—') + ' : ' + (x.away_score ?? '—') + '</div></div>'
      ).join('') : '<p class="es-note">Zatiaľ bez potvrdeného zápasu FC27/Volta. Počet eSports zápasov vyššie ukazuje, či samotný feed odpovedá.</p>';
    } catch (e) {
      statusEl.textContent = 'Čakám na prvú kontrolu Flashscore eSports: ' + e.message;
      metricsEl.textContent = 'Bez potvrdených dát';
      listEl.innerHTML = '<p class="es-note">Panel zobrazí iba zápasy vrátené zdrojom, nie ukážkové dáta.</p>';
    }
  }
  load();
  setInterval(load, 60000);
})();
