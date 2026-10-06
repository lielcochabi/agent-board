(function () {
  var $ = function (id) { return document.getElementById(id); };
  var state = { projects: [], project: null, agents: [], outputs: [], commits: [], tab: 'outputs', agent: null, kind: 'All', sel: null };
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
  function post(url, body) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board': '1' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); });
  }

  // The hash holds view state so a reload or a pasted link lands in the same place: #p=jarvis&t=outputs&a=forge&k=Plans&f=...
  function writeHash() {
    var p = new URLSearchParams();
    if (state.project) p.set('p', state.project);
    if (state.tab !== 'outputs') p.set('t', state.tab);
    if (state.agent) p.set('a', state.agent);
    if (state.kind !== 'All') p.set('k', state.kind);
    if (state.sel) p.set('f', state.sel);
    history.replaceState(null, '', '#' + p.toString());
  }
  function readHash() {
    var p = new URLSearchParams(location.hash.slice(1));
    state.project = p.get('p'); state.tab = p.get('t') || 'outputs'; state.agent = p.get('a'); state.kind = p.get('k') || 'All'; state.sel = p.get('f');
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

  // ---------- rail ----------
  function renderProjects() {
    var s = $('project'); s.textContent = '';
    state.projects.forEach(function (p) {
      var o = el('option', null, p.name); o.value = p.id; if (p.id === state.project) o.selected = true; s.appendChild(o);
    });
  }
  function renderAgents() {
    var a = $('agents'); a.textContent = '';
    if (!state.agents.length) {
      a.appendChild(el('div', 'noagents', 'No agents in this project yet. Use New agent to create the first one.'));
      return;
    }
    state.agents.forEach(function (g) {
      var live = g.state !== 'idle';
      var b = el('button', 'row ' + (live ? 'live' : 'idle')); b.type = 'button'; b.dataset.state = g.state;
      b.setAttribute('aria-pressed', state.agent === g.name ? 'true' : 'false');
      var ico = el('span', 'ico'); ico.innerHTML = ICONS[g.state] || ICONS.idle; b.appendChild(ico);
      var nm = el('span', 'nm'); var n = el('span', null, g.name); n.setAttribute('translate', 'no'); nm.appendChild(n); nm.appendChild(el('small', null, g.role)); b.appendChild(nm);
      b.appendChild(el('span', 'tail', g.missions ? g.missions + (g.missions > 1 ? ' missions' : ' mission') : ''));
      if (live && g.task && g.task !== '-') b.appendChild(el('span', 'task', g.task));
      if (live) {
        var step = [g.step && g.step !== '-' ? g.step : '', g.updated && g.updated !== '-' ? when(g.updated) : ''].filter(Boolean).join(' · ');
        if (step) b.appendChild(el('span', 'step', step));
      }
      b.addEventListener('click', function () { state.agent = state.agent === g.name ? null : g.name; state.tab = 'outputs'; writeHash(); renderAgents(); renderMain(); });
      a.appendChild(b);
    });
  }
  function renderStatus() {
    var n = state.agents.filter(function (a) { return a.state === 'running'; }).length;
    $('running').textContent = '';
    var b = el('b', null, String(n)); $('running').appendChild(b); $('running').appendChild(document.createTextNode(n === 1 ? ' agent running' : ' agents running'));
  }

  // ---------- main ----------
  function renderTabs() {
    document.querySelectorAll('.tab').forEach(function (t) { t.setAttribute('aria-selected', t.dataset.tab === state.tab ? 'true' : 'false'); });
  }
  function renderMain() {
    renderTabs();
    var body = $('body'); body.textContent = '';
    if (state.tab === 'commits') {
      body.style.display = 'flex';
      var c = el('div', 'commits');
      if (!state.commits.length) c.appendChild(el('div', 'empty', 'No commits to show. This project may not be a git repository yet.'));
      state.commits.forEach(function (g) {
        var r = el('div', 'commit'); r.appendChild(el('code', null, g.hash)); r.appendChild(el('span', null, g.subject)); r.appendChild(el('small', null, g.author + ' · ' + g.when)); c.appendChild(r);
      });
      body.appendChild(c); return;
    }
    body.style.display = '';
    var out = el('section', 'outputs'); out.setAttribute('aria-label', 'Outputs');
    var f = el('div', 'ofilter');
    var lab = el('label', 'field'); lab.appendChild(el('span', null, 'Show'));
    var sel = el('select'); sel.id = 'kind'; sel.name = 'kind';
    var kinds = ['All'];
    state.outputs.forEach(function (x) { if (kinds.indexOf(x.kind) < 0) kinds.push(x.kind); });
    kinds.forEach(function (k) { var o = el('option', null, k === 'All' ? 'All outputs' : k); o.value = k; if (k === state.kind) o.selected = true; sel.appendChild(o); });
    sel.addEventListener('change', function () { state.kind = sel.value; writeHash(); renderList(); });
    lab.appendChild(sel); f.appendChild(lab);
    var note = el('div', 'note'); note.id = 'note'; f.appendChild(note);
    out.appendChild(f);
    var list = el('div', 'olist'); list.id = 'olist'; out.appendChild(list);
    body.appendChild(out);
    var v = el('main', 'viewer'); v.id = 'viewer'; v.tabIndex = -1;
    var w = el('div', 'welcome'); w.appendChild(el('h2', null, 'Pick something to read')); w.appendChild(el('p', null, 'Choose an output on the left to read it here. Select an agent in the rail to see only what it produced.'));
    v.appendChild(w); body.appendChild(v);
    renderList();
    if (state.sel) openFile(state.sel);
  }
  function renderList() {
    var list = $('olist'); if (!list) return; list.textContent = '';
    var note = $('note'); note.textContent = '';
    if (state.agent) {
      note.appendChild(el('span', null, 'Only ' + state.agent));
      var x = el('button', null, 'Show all'); x.type = 'button';
      x.addEventListener('click', function () { state.agent = null; writeHash(); renderAgents(); renderList(); });
      note.appendChild(x);
    }
    var shown = state.outputs.filter(function (o) { return (!state.agent || o.agent === state.agent) && (state.kind === 'All' || o.kind === state.kind); });
    if (!shown.length) list.appendChild(el('div', 'empty', state.agent ? state.agent + ' has not produced any outputs yet. Its files appear here as it works.' : 'Nothing here yet. Agents write plans, notes and reviews to this project\'s docs folder.'));
    shown.forEach(function (o) {
      var b = el('button', 'item'); b.type = 'button'; if (state.sel === o.id) b.setAttribute('aria-current', 'true');
      b.appendChild(el('b', null, o.name));
      var s = el('small'); s.appendChild(el('span', null, o.kind)); s.appendChild(el('span', null, ago(o.mtime))); b.appendChild(s);
      b.addEventListener('click', function () { state.sel = o.id; writeHash(); renderList(); openFile(o.id); });
      list.appendChild(b);
    });
  }
  function openFile(id) {
    fetch('/api/file?id=' + encodeURIComponent(id)).then(function (r) { return r.json(); }).then(function (d) {
      var v = $('viewer'); if (!v) return;
      var keep = v.scrollTop; v.textContent = '';
      if (d.error) { var w = el('div', 'welcome'); w.appendChild(el('h2', null, 'That file is gone')); w.appendChild(el('p', null, 'It was moved or deleted. Pick another output from the list.')); v.appendChild(w); return; }
      var meta = state.outputs.filter(function (x) { return x.id === id; })[0] || {};
      var h = el('div', 'vhead'); h.appendChild(el('h2', null, meta.name || id));
      var m = el('div', 'vmeta');
      if (meta.kind) m.appendChild(el('span', 'badge', meta.kind));
      if (meta.agent) m.appendChild(el('span', null, 'by ' + meta.agent));
      m.appendChild(el('span', null, 'Updated ' + dtf.format(d.mtime)));
      var cp = el('button', 'btn copy', 'Copy path'); cp.type = 'button';
      cp.addEventListener('click', function () {
        var done = function () { cp.textContent = 'Copied'; setTimeout(function () { cp.textContent = 'Copy path'; }, 1500); };
        try { navigator.clipboard.writeText(id.replace(/^[^:]*:/, '')).then(done, function () {}); } catch (e) {}
      });
      m.appendChild(cp); h.appendChild(m); v.appendChild(h);
      var doc = el('article', 'doc'); doc.innerHTML = md(d.text); v.appendChild(doc);
      v.scrollTop = keep;
    });
  }

  // ---------- data ----------
  function loadProjects() {
    return fetch('/api/projects').then(function (r) { return r.json(); }).then(function (ps) {
      state.projects = ps;
      if (!ps.some(function (p) { return p.id === state.project; })) state.project = ps[0] && ps[0].id;
      renderProjects();
    });
  }
  function load() {
    return fetch('/api/state?project=' + encodeURIComponent(state.project || '')).then(function (r) { return r.json(); }).then(function (d) {
      var first = !state.loaded; state.loaded = true;
      state.agents = d.agents; state.outputs = d.outputs; state.commits = d.commits;
      renderAgents(); renderStatus();
      if (first || state.tab === 'commits') renderMain();
      else { renderList(); if (state.sel) openFile(state.sel); }
    });
  }
  $('project').addEventListener('change', function () {
    state.project = $('project').value; state.agent = null; state.sel = null; state.kind = 'All'; state.loaded = false; writeHash(); load();
  });
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () { state.tab = t.dataset.tab; writeHash(); renderMain(); });
  });

  // ---------- dialogs ----------
  function fillProjectSelect(sel) {
    sel.textContent = '';
    state.projects.forEach(function (p) { var o = el('option', null, p.name); o.value = p.id; if (p.id === state.project) o.selected = true; sel.appendChild(o); });
  }
  var agentDlg = $('agentDlg'), agentForm = $('agentForm');
  var agentFormHTML = agentForm.innerHTML, nameTouched = false;
  function wireAgentForm() {
    nameTouched = false;
    $('a-name').addEventListener('input', function () { nameTouched = true; });
    $('a-role').addEventListener('input', function () {
      if (!nameTouched) $('a-name').value = $('a-role').value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
    });
    $('a-cancel').addEventListener('click', function () { agentDlg.close(); });
    fillProjectSelect($('a-project'));
  }
  wireAgentForm();
  $('newAgent').addEventListener('click', function () {
    if (!state.projects.length) return;
    agentForm.innerHTML = agentFormHTML; wireAgentForm(); agentForm.reset(); fillProjectSelect($('a-project'));
    agentDlg.showModal(); $('a-name').focus();
  });
  agentForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = $('a-submit'), err = $('a-err'); err.textContent = '';
    btn.disabled = true; btn.textContent = 'Creating…';
    post('/api/agents', {
      project: $('a-project').value, name: $('a-name').value.trim(), role: $('a-role').value.trim(), description: $('a-desc').value.trim(),
      preset: $('a-preset').value, instructions: $('a-instr').value, scope: $('a-scope').value.trim()
    }).then(function (r) {
      if (r.error) { err.textContent = r.error; btn.disabled = false; btn.textContent = 'Create agent'; return; }
      var proj = state.projects.filter(function (p) { return p.id === r.project; })[0] || {};
      agentForm.textContent = '';
      agentForm.appendChild(el('h2', null, r.name + ' is ready'));
      agentForm.appendChild(el('p', 'lede', 'It shows in the rail now. To run it, open Claude Code in this project folder and say:'));
      agentForm.appendChild(el('pre', null, 'Use the ' + r.name + ' agent to <what you want done>'));
      agentForm.appendChild(el('p', 'hint', 'Project folder: ' + (proj.root || r.root) + '. Agents are project-level, so they only exist in sessions opened there.'));
      var ul = el('ul'); r.files.forEach(function (f) { ul.appendChild(el('li', null, f)); }); agentForm.appendChild(ul);
      var act = el('div', 'actions'); var close = el('button', 'btn primary', 'Done'); close.type = 'button';
      close.addEventListener('click', function () { agentDlg.close(); }); act.appendChild(close); agentForm.appendChild(act);
      if (r.project !== state.project) { state.project = r.project; state.loaded = false; renderProjects(); writeHash(); }
      load();
    }).catch(function () { err.textContent = 'Could not reach the board server. Is it still running?'; btn.disabled = false; btn.textContent = 'Create agent'; });
  });

  var projectDlg = $('projectDlg'), projectForm = $('projectForm');
  $('newProject').addEventListener('click', function () { projectForm.reset(); $('p-err').textContent = ''; projectDlg.showModal(); $('p-name').focus(); });
  $('p-cancel').addEventListener('click', function () { projectDlg.close(); });
  projectForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = $('p-submit'), err = $('p-err'); err.textContent = '';
    btn.disabled = true; btn.textContent = 'Adding…';
    post('/api/projects', { name: $('p-name').value.trim(), root: $('p-root').value.trim() }).then(function (r) {
      btn.disabled = false; btn.textContent = 'Add project';
      if (r.error) { err.textContent = r.error; return; }
      projectDlg.close(); state.project = r.project.id; state.agent = null; state.sel = null; state.loaded = false;
      loadProjects().then(function () { writeHash(); load(); });
    }).catch(function () { btn.disabled = false; btn.textContent = 'Add project'; err.textContent = 'Could not reach the board server. Is it still running?'; });
  });

  // ---------- live ----------
  function live(on) { var e = $('live'); e.className = 'live-dot' + (on ? ' on' : ''); e.lastChild.textContent = on ? 'Live' : 'Reconnecting…'; }
  var es = new EventSource('/api/events');
  es.onopen = function () { live(true); };
  es.onerror = function () { live(false); };
  es.onmessage = function () { load(); };

  readHash();
  loadProjects().then(function () { writeHash(); return load(); });
})();
