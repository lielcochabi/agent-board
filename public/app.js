(function () {
  var $ = function (id) { return document.getElementById(id); };
  var RELAY = ['scout', 'compass', 'forge', 'echo', 'sentry', 'warden', 'herald'];
  var ON_DEMAND = ['scribe', 'custodian'];
  var state = { agents: [], outputs: [], commits: [], agent: null, kind: 'All', sel: null };
  var rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  var dtf = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function ago(ms) {
    var s = (ms - Date.now()) / 1000, a = Math.abs(s);
    if (a < 60) return 'just now';
    if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
    if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
    return rtf.format(Math.round(s / 86400), 'day');
  }
  function when(str) { var t = Date.parse(str); return isNaN(t) ? str : dtf.format(t); }

  // Hash holds the view state so a reload or a shared link lands in the same place: #a=forge&k=Plans&f=plans/x.md
  function writeHash() {
    var p = new URLSearchParams();
    if (state.agent) p.set('a', state.agent);
    if (state.kind !== 'All') p.set('k', state.kind);
    if (state.sel) p.set('f', state.sel);
    history.replaceState(null, '', p.toString() ? '#' + p.toString() : location.pathname);
  }
  function readHash() {
    var p = new URLSearchParams(location.hash.slice(1));
    state.agent = p.get('a'); state.kind = p.get('k') || 'All'; state.sel = p.get('f');
  }

  var ICONS = {
    idle: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2.5 2.2"/></svg>',
    running: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".25"/><path class="spin" d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    done: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M5 8.2l2 2 4-4.2" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    blocked: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.2 8h5.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    failed: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>'
  };

  // Small markdown renderer. Input is escaped first, so only the tags produced here reach the DOM.
  function inline(t) {
    t = esc(t);
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
    t = t.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return t;
  }
  function md(src) {
    var lines = src.replace(/\r/g, '').split('\n'), out = [], i = 0;
    while (i < lines.length) {
      var l = lines[i], m;
      if (/^```/.test(l)) {
        var code = []; i++;
        while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
        i++; out.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>'); continue;
      }
      if ((m = l.match(/^(#{1,4})\s+(.*)$/))) { out.push('<h' + m[1].length + '>' + inline(m[2]) + '</h' + m[1].length + '>'); i++; continue; }
      if (/^---+\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
      if (/^>\s?/.test(l)) {
        var q = []; while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ''));
        out.push('<blockquote>' + inline(q.join(' ')) + '</blockquote>'); continue;
      }
      if (/^\s*\|.*\|\s*$/.test(l) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
        var head = l.trim().replace(/^\||\|$/g, '').split('|'); i += 2;
        var rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++].trim().replace(/^\||\|$/g, '').split('|'));
        out.push('<table><thead><tr>' + head.map(function (c) { return '<th>' + inline(c.trim()) + '</th>'; }).join('') + '</tr></thead><tbody>' +
          rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + inline(c.trim()) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>');
        continue;
      }
      if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
        var ord = /^\s*\d+\./.test(l), items = [];
        while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
          var it = lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, '');
          while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s+/.test(lines[i])) it += ' ' + lines[i++].trim();
          items.push('<li>' + inline(it) + '</li>');
        }
        out.push((ord ? '<ol>' : '<ul>') + items.join('') + (ord ? '</ol>' : '</ul>')); continue;
      }
      if (!l.trim()) { i++; continue; }
      var p = [];
      while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>|---+\s*$|\s*([-*]|\d+\.)\s+|\s*\|)/.test(lines[i])) p.push(lines[i++]);
      if (!p.length) p.push(lines[i++]);
      out.push('<p>' + inline(p.join(' ')) + '</p>');
    }
    return out.join('\n');
  }

  function byName(n) { return state.agents.filter(function (a) { return a.name === n; })[0] || { name: n, state: 'idle' }; }
  function setAgent(n) { state.agent = state.agent === n ? null : n; writeHash(); renderRelay(); renderAgents(); renderOutputs(); }

  function renderTally() {
    var c = { running: 0, blocked: 0, failed: 0, done: 0 };
    state.agents.forEach(function (a) { if (c[a.state] != null) c[a.state]++; });
    var t = $('tally'); t.textContent = '';
    Object.keys(c).forEach(function (k) {
      var s = el('span', k); s.appendChild(el('i')); s.appendChild(el('b', null, String(c[k]))); s.appendChild(document.createTextNode(k)); t.appendChild(s);
    });
  }

  function node(n) {
    var a = byName(n), b = el('button', 'node'); b.type = 'button'; b.dataset.state = a.state;
    b.setAttribute('aria-pressed', state.agent === n ? 'true' : 'false');
    b.appendChild(el('span', 'dot')); var s = el('span', null, n); s.setAttribute('translate', 'no'); b.appendChild(s);
    b.title = a.state; b.addEventListener('click', function () { setAgent(n); });
    return b;
  }
  function renderRelay() {
    var r = $('relay'); r.textContent = '';
    r.appendChild(el('span', 'lbl', 'Relay'));
    RELAY.forEach(function (n, i) { if (i) r.appendChild(el('span', 'sep', '›')); r.appendChild(node(n)); });
    r.appendChild(el('span', 'gap'));
    r.appendChild(el('span', 'lbl', 'On demand'));
    ON_DEMAND.forEach(function (n) { r.appendChild(node(n)); });
  }

  function renderAgents() {
    var a = $('agents'); a.textContent = '';
    a.appendChild(el('h2', null, 'Agents'));
    state.agents.forEach(function (g) {
      var b = el('button', 'row'); b.type = 'button'; b.dataset.state = g.state;
      b.setAttribute('aria-pressed', state.agent === g.name ? 'true' : 'false');
      var ico = el('span', 'ico'); ico.innerHTML = ICONS[g.state] || ICONS.idle; b.appendChild(ico);
      var nm = el('span', 'nm'); nm.appendChild(el('span', null, g.name)); nm.firstChild.setAttribute('translate', 'no'); nm.appendChild(el('small', null, g.role)); b.appendChild(nm);
      b.appendChild(el('span', 'when', g.missions ? g.missions + (g.missions > 1 ? ' missions' : ' mission') : ''));
      if (g.task && g.task !== '-') b.appendChild(el('span', 'task', g.task));
      var step = [g.step && g.step !== '-' ? g.step : '', g.updated && g.updated !== '-' ? when(g.updated) : ''].filter(Boolean).join(' · ');
      if (step) b.appendChild(el('span', 'step', step));
      b.addEventListener('click', function () { setAgent(g.name); });
      a.appendChild(b);
    });
    var cm = el('div', 'commits'); cm.appendChild(el('h2', null, 'Recent commits'));
    state.commits.forEach(function (g) {
      var d = el('div', 'commit'); d.appendChild(el('code', null, g.hash)); d.appendChild(el('span', null, g.subject)); d.title = g.subject + ' · ' + g.when; cm.appendChild(d);
    });
    a.appendChild(cm);
  }

  function renderOutputs() {
    var o = $('outputs'); o.textContent = '';
    var kinds = ['All'];
    state.outputs.forEach(function (x) { if (kinds.indexOf(x.kind) < 0) kinds.push(x.kind); });
    var f = el('div', 'chips');
    kinds.forEach(function (k) {
      var b = el('button', 'chip', k); b.type = 'button'; b.setAttribute('aria-pressed', state.kind === k ? 'true' : 'false');
      b.addEventListener('click', function () { state.kind = k; writeHash(); renderOutputs(); }); f.appendChild(b);
    });
    o.appendChild(f);
    if (state.agent) { var n = el('div', 'note', 'Filtered to ' + state.agent + '. Select it again to clear.'); o.appendChild(n); }
    var shown = state.outputs.filter(function (x) { return (!state.agent || x.agent === state.agent) && (state.kind === 'All' || x.kind === state.kind); });
    if (!shown.length) o.appendChild(el('div', 'empty', state.agent ? state.agent + ' has not produced any outputs yet.' : 'No outputs yet.'));
    shown.forEach(function (x) {
      var b = el('button', 'item'); b.type = 'button'; if (state.sel === x.id) b.setAttribute('aria-current', 'true');
      b.appendChild(el('b', null, x.name));
      var s = el('small'); s.appendChild(el('em', null, x.kind)); s.appendChild(el('span', null, ago(x.mtime))); b.appendChild(s);
      b.addEventListener('click', function () { state.sel = x.id; writeHash(); renderOutputs(); openFile(x.id); }); o.appendChild(b);
    });
  }

  function openFile(id) {
    fetch('/api/file?id=' + encodeURIComponent(id)).then(function (r) { return r.json(); }).then(function (d) {
      var v = $('viewer'), keep = v.scrollTop; v.textContent = '';
      if (d.error) { var w = el('div', 'welcome'); w.appendChild(el('h2', null, 'That file is gone')); w.appendChild(el('p', null, 'It was moved or deleted. Pick another output from the list.')); v.appendChild(w); return; }
      var meta = state.outputs.filter(function (x) { return x.id === id; })[0] || {};
      var h = el('div', 'vhead'); h.appendChild(el('h2', null, meta.name || id));
      var m = el('div', 'vmeta');
      if (meta.kind) m.appendChild(el('span', 'badge', meta.kind));
      if (meta.agent) m.appendChild(el('span', null, 'by ' + meta.agent));
      m.appendChild(el('span', null, 'Updated ' + dtf.format(d.mtime)));
      var cp = el('button', 'copy', 'Copy path'); cp.type = 'button';
      cp.addEventListener('click', function () {
        var done = function () { cp.textContent = 'Copied'; setTimeout(function () { cp.textContent = 'Copy path'; }, 1500); };
        try { navigator.clipboard.writeText(id).then(done, function () {}); } catch (e) {}
      });
      m.appendChild(cp); h.appendChild(m); v.appendChild(h);
      var doc = el('article', 'doc'); doc.innerHTML = md(d.text); v.appendChild(doc);
      v.scrollTop = keep;
    });
  }

  function load() {
    return fetch('/api/state').then(function (r) { return r.json(); }).then(function (d) {
      state.agents = d.agents; state.outputs = d.outputs; state.commits = d.commits;
      renderTally(); renderRelay(); renderAgents(); renderOutputs();
      if (state.sel) openFile(state.sel);
    });
  }

  function live(on) { var e = $('live'); e.className = 'live' + (on ? ' on' : ''); e.lastChild.textContent = on ? 'Live' : 'Reconnecting…'; }
  var es = new EventSource('/api/events');
  es.onopen = function () { live(true); };
  es.onerror = function () { live(false); };
  es.onmessage = function () { load(); };

  readHash();
  load();
})();
