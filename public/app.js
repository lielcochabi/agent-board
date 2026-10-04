(function () {
  var $ = function (id) { return document.getElementById(id); };
  var state = { agents: [], outputs: [], commits: [], filter: null, kind: 'All', sel: null };

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function ago(ms) {
    var s = Math.max(0, (Date.now() - ms) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

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

  function renderTally() {
    var c = { running: 0, blocked: 0, failed: 0, done: 0 };
    state.agents.forEach(function (a) { if (c[a.state] != null) c[a.state]++; });
    var t = $('tally'); t.textContent = '';
    Object.keys(c).forEach(function (k) {
      var s = el('span'); var b = el('b', null, String(c[k])); s.appendChild(b); s.appendChild(document.createTextNode(' ' + k)); t.appendChild(s);
    });
  }

  function renderRail() {
    var rail = $('rail'); rail.textContent = '';
    state.agents.forEach(function (a) {
      var c = el('button', 'card' + (state.filter === a.name ? ' sel' : ''));
      c.type = 'button'; c.dataset.state = a.state;
      var n = el('div', 'nm', a.name); n.appendChild(el('small', null, a.role));
      c.appendChild(n); c.appendChild(el('span', 'pill', a.state));
      if (a.task && a.task !== '-') c.appendChild(el('p', 'task', a.task));
      if (a.step && a.step !== '-') c.appendChild(el('p', null, a.step));
      var meta = [];
      if (a.updated && a.updated !== '-') meta.push('updated ' + a.updated);
      if (a.missions) meta.push(a.missions + ' mission' + (a.missions > 1 ? 's' : ''));
      if (meta.length) c.appendChild(el('p', 'meta', meta.join(' · ')));
      c.addEventListener('click', function () { state.filter = state.filter === a.name ? null : a.name; renderRail(); renderList(); });
      rail.appendChild(c);
    });
    var cm = el('div', 'commits'); cm.appendChild(el('div', 'sec', 'Recent commits'));
    state.commits.forEach(function (g) {
      var d = el('div'); var b = el('b', null, g.hash); d.appendChild(b); d.appendChild(document.createTextNode(' ' + g.subject + ' (' + g.when + ')')); cm.appendChild(d);
    });
    rail.appendChild(cm);
  }

  function renderList() {
    var list = $('list'); list.textContent = '';
    var kinds = ['All'];
    state.outputs.forEach(function (o) { if (kinds.indexOf(o.kind) < 0) kinds.push(o.kind); });
    var f = el('div', 'filters');
    kinds.forEach(function (k) {
      var b = el('button', 'chip' + (state.kind === k ? ' on' : ''), k); b.type = 'button';
      b.addEventListener('click', function () { state.kind = k; renderList(); }); f.appendChild(b);
    });
    list.appendChild(f);
    if (state.filter) list.appendChild(el('div', 'sec', 'Showing ' + state.filter));
    var shown = state.outputs.filter(function (o) {
      return (!state.filter || o.agent === state.filter) && (state.kind === 'All' || o.kind === state.kind);
    });
    if (!shown.length) list.appendChild(el('div', 'empty', 'No outputs match yet.'));
    shown.forEach(function (o) {
      var b = el('button', 'item' + (state.sel === o.id ? ' sel' : '')); b.type = 'button';
      b.appendChild(el('b', null, o.name)); b.appendChild(el('span', null, o.kind + ' · ' + ago(o.mtime)));
      b.addEventListener('click', function () { open(o.id); }); list.appendChild(b);
    });
  }

  function open(id, quiet) {
    state.sel = id; if (!quiet) location.hash = encodeURIComponent(id);
    fetch('/api/file?id=' + encodeURIComponent(id)).then(function (r) { return r.json(); }).then(function (d) {
      var v = $('viewer'); v.textContent = '';
      if (d.error) { v.appendChild(el('div', 'empty', 'That file is no longer there.')); return; }
      v.appendChild(el('div', 'path', id));
      var doc = el('article', 'doc'); doc.innerHTML = md(d.text); v.appendChild(doc);
      renderList();
    });
  }

  function load() {
    return fetch('/api/state').then(function (r) { return r.json(); }).then(function (d) {
      state.agents = d.agents; state.outputs = d.outputs; state.commits = d.commits;
      renderTally(); renderRail(); renderList();
      if (state.sel) open(state.sel, true);
    });
  }

  function live(on) {
    var e = $('live'); e.className = 'live' + (on ? ' on' : '');
    e.lastChild.textContent = on ? 'live' : 'reconnecting';
  }
  var es = new EventSource('/api/events');
  es.onopen = function () { live(true); };
  es.onerror = function () { live(false); };
  es.onmessage = function () { load(); };

  var h = decodeURIComponent(location.hash.slice(1));
  if (h) state.sel = h;
  load();
})();
