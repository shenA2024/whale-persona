/**
 * @shenA2024/whale-persona-ui —— 设置面板（浏览器半身）
 *
 * 手写懒 CJS bundle，零依赖零构建：宿主只认「已构建的 __ModuleLoader__ bundle」这个契约，
 * require 只能命中基座模块（react 在里面），所以用 createElement 手写组件——
 * 改一行保存、刷新页面就生效，没有编译步骤，不联网，不引任何第三方。
 *
 * 挂载位：settings.section（官方给仓库外插件预留的整页设置位）。
 * 本面板**只读**：写配置只有两条路——本地编辑器（scripts/ui.mjs）或让 AI 改。
 *
 * 数据来源：同源 GET /whale-persona/api/summary（宿主半身 adapters/dsh-ui/index.js）。
 *   档位参数**两个都发**：?tier=flash|pro（当前宿主实现读这个）＋ ?model=deepseek-v4-*（跨宿主契约口径）；
 *   多出来的那个参数服务端会忽略——面板不必猜面对的是哪一版宿主。
 *   字段兜底读：exists ← exists | configState.exists；memory.entries ← entries | manualEntries；
 *   memory.recent 兼容 ["原文"] 与 [{text,tag}]；editor.port ← port | 从 url 里解析。
 *   失败路径（网络异常 / 非 2xx / 非 JSON）一律不崩：显示一行可读错误 + 保留重试按钮。
 *
 * 生效时机：改配置下一步生效，改挂载行要新会话。
 */
window.__ModuleLoader__.load({
  id: '@shenA2024/whale-persona-ui',
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require('react');
    var h = React.createElement;

    var API = '/whale-persona/api/summary';
    /** 面板看到的三段是按模型档渲染的：切换档位即带参数重新 fetch */
    var TIERS = [
      { id: 'flash', model: 'deepseek-v4-flash', label: 'flash 档' },
      { id: 'pro', model: 'deepseek-v4-pro', label: 'pro 档' },
    ];
    var EMPTY_SEG = '（空 —— 这一段不会出现在系统提示词里）';

    /** hooks 兜底：宿主基座 shim 不完整时降级成「静态渲染」，不连累设置页 */
    var useState = typeof React.useState === 'function' ? React.useState : function (v) { return [v, function () {}]; };
    var useEffect = typeof React.useEffect === 'function' ? React.useEffect : function () {};
    /** 请求序号：档位连点时丢弃过期响应（不依赖 effect 清理函数，stub 环境也成立） */
    var reqSeq = 0;

    /* ══════════════════════════════════════════════════════════════════════
     * 样式：自己注入、自己的 wpr- 前缀、跟随宿主深色底（rgba 半透明 + 宿主 CSS 变量），
     * 不写死白底黑字；清理函数里 style.remove()。
     * ══════════════════════════════════════════════════════════════════════ */
    var CSS = [
      '.wpr-wrap{padding:18px 22px 40px;max-width:860px;color:var(--dsw-alias-text-1,#e6e6e6);font-size:13px;line-height:1.65}',
      '.wpr-head{display:flex;align-items:center;gap:8px}',
      '.wpr-h1{font-size:16px;font-weight:600;margin:0}',
      '.wpr-spacer{margin-left:auto}',
      '.wpr-sub{color:var(--dsw-alias-text-2,#9aa0a6);font-size:12px}',
      '.wpr-btn{background:transparent;border:1px solid var(--dsw-alias-border-1,rgba(127,127,127,.3));color:inherit;',
      'border-radius:6px;padding:3px 10px;font:inherit;font-size:12px;cursor:pointer;transition:border-color .16s ease,background .16s ease}',
      '.wpr-btn:hover:not([disabled]){border-color:rgba(127,127,127,.55);background:rgba(127,127,127,.10)}',
      '.wpr-btn[disabled]{opacity:.42;cursor:default}',
      '.wpr-btn.wpr-primary{border-color:rgba(76,141,255,.5);background:rgba(76,141,255,.14);color:#eaf2ff}',
      '.wpr-btn.wpr-primary:hover:not([disabled]){background:rgba(76,141,255,.22)}',
      '.wpr-card{border:1px solid var(--dsw-alias-border-1,rgba(127,127,127,.28));border-radius:8px;',
      'background:var(--dsw-alias-bg-2,rgba(127,127,127,.07));padding:12px 14px;margin:12px 0}',
      '.wpr-cardhead{display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap}',
      '.wpr-title{font-weight:600;font-size:13px}',
      '.wpr-row{display:flex;align-items:baseline;gap:8px;margin:4px 0;flex-wrap:wrap}',
      '.wpr-k{color:var(--dsw-alias-text-2,#9aa0a6);flex:0 0 auto;min-width:84px}',
      '.wpr-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;',
      'word-break:break-all;user-select:text;-webkit-user-select:text}',
      '.wpr-badge{display:inline-block;border:1px solid rgba(127,127,127,.35);border-radius:999px;padding:0 8px;',
      'font-size:11px;line-height:18px;color:var(--dsw-alias-text-2,#9aa0a6);white-space:nowrap}',
      '.wpr-badge.wpr-on{color:#8fe3ad;border-color:rgba(63,185,80,.45);background:rgba(63,185,80,.12)}',
      '.wpr-badge.wpr-off{color:#e8b071;border-color:rgba(229,160,75,.45);background:rgba(229,160,75,.12)}',
      '.wpr-alert{border:1px solid rgba(229,160,75,.45);background:rgba(229,160,75,.12);color:#e8b071;',
      'border-radius:6px;padding:6px 10px;margin:8px 0}',
      '.wpr-alert.wpr-bad{border-color:rgba(229,83,75,.5);background:rgba(229,83,75,.12);color:#f08a84}',
      '.wpr-tier{display:inline-flex;border:1px solid rgba(127,127,127,.3);border-radius:999px;overflow:hidden;',
      'margin:0 0 8px;background:rgba(127,127,127,.06)}',
      '.wpr-tier button{background:transparent;border:0;color:inherit;font:inherit;font-size:12px;',
      'padding:2px 12px;cursor:pointer}',
      '.wpr-tier button.wpr-active{background:rgba(76,141,255,.22);color:#eaf2ff}',
      '.wpr-seg{border:1px solid rgba(127,127,127,.25);border-radius:6px;margin:8px 0;overflow:hidden;',
      'background:rgba(127,127,127,.05)}',
      '.wpr-seghead{display:flex;align-items:center;gap:8px;width:100%;padding:6px 10px;border:0;',
      'background:transparent;color:inherit;font:inherit;cursor:pointer;text-align:left}',
      '.wpr-seghead:hover{background:rgba(127,127,127,.10)}',
      '.wpr-caret{font-size:9px;opacity:.7;width:10px;flex:none}',
      '.wpr-pre{margin:0;padding:8px 10px;border-top:1px solid rgba(127,127,127,.25);max-height:280px;overflow:auto;',
      'white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;',
      'font-size:12px;line-height:1.6;user-select:text;-webkit-user-select:text}',
      '.wpr-empty{color:var(--dsw-alias-text-2,#9aa0a6);font-style:italic}',
      '.wpr-contract{display:flex;gap:8px;align-items:flex-start;padding:5px 0;border-top:1px solid rgba(127,127,127,.22)}',
      '.wpr-contract:first-of-type{border-top:0}',
      '.wpr-ctext{flex:1;min-width:0;white-space:pre-wrap;word-break:break-word}',
      '.wpr-strike{text-decoration:line-through;color:var(--dsw-alias-text-2,#9aa0a6);opacity:.8}',
      '.wpr-dimnote{color:var(--dsw-alias-text-2,#9aa0a6);font-size:11px;white-space:nowrap}',
      '.wpr-note{color:var(--dsw-alias-text-2,#9aa0a6);font-size:11px;margin:6px 0 2px}',
      '.wpr-quote{border-left:2px solid rgba(127,127,127,.38);padding:2px 0 2px 8px;margin:4px 0;',
      'color:var(--dsw-alias-text-2,#9aa0a6);white-space:pre-wrap;word-break:break-word}',
      '.wpr-cmd{display:inline-flex;align-items:center;gap:8px;margin-top:8px;padding:4px 10px;',
      'border:1px dashed rgba(127,127,127,.42);border-radius:6px}',
      '.wpr-footline{margin-top:14px;color:var(--dsw-alias-text-2,#9aa0a6);font-size:11px}',
    ].join('');

    /* ── 取数 ───────────────────────────────────────────────────────────── */

    function messageOf(e) {
      if (!e) return '未知错误';
      return String((e && e.message) || e);
    }

    function loadSummary(tier) {
      var t = tierOf(tier);
      var url = API + '?tier=' + encodeURIComponent(t.id) + '&model=' + encodeURIComponent(t.model);
      if (typeof fetch !== 'function') return Promise.reject(new Error('环境里没有 fetch'));
      var p;
      try {
        p = Promise.resolve(fetch(url, { headers: { accept: 'application/json' } }));
      } catch (e) {
        // fetch 本身同步抛错（旧宿主 / 被代理拦下）
        return Promise.reject(new Error(messageOf(e)));
      }
      return p.then(readBody).then(function (res) {
        var data = res && res.data;
        if (res && typeof res.status === 'number' && (res.status < 200 || res.status >= 300)) {
          throw new Error('HTTP ' + res.status + (data && data.error ? '：' + data.error : ''));
        }
        if (!data || typeof data !== 'object') throw new Error('返回内容不是 JSON');
        if (data.ok === false) throw new Error(String(data.error || '接口返回 ok=false'));
        return normalize(data, t.id);
      }, function (e) {
        throw new Error(messageOf(e));
      });
    }

    /** 响应读取：优先 text()（非 JSON 也不炸），没有就退 json()，再没有就当空体 */
    function readBody(r) {
      if (!r) return { status: 0, data: null };
      if (typeof r.text === 'function') {
        return Promise.resolve(r.text()).then(function (t) {
          var data = null;
          try { data = t ? JSON.parse(t) : null; } catch (e) { data = null; }
          return { status: r.status, data: data };
        }, function () { return { status: r.status, data: null }; });
      }
      if (typeof r.json === 'function') {
        return Promise.resolve(r.json()).then(function (d) { return { status: r.status, data: d }; },
          function () { return { status: r.status, data: null }; });
      }
      return { status: r.status, data: null };
    }

    function tierOf(id) {
      for (var i = 0; i < TIERS.length; i++) if (TIERS[i].id === id) return TIERS[i];
      return TIERS[0];
    }

    function strOf(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)); }

    function numOf(v) { var n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; }

    /** 把两种口径的响应收敛成一种形状：面板渲染只认这里 */
    function normalize(d, tierId) {
      var mem = (d && d.memory) || {};
      var cs = (d && d.configState) || {};
      var ed = (d && d.editor) || {};
      var sec = (d && d.sections) || {};
      var recentRaw = Array.isArray(mem.recent) ? mem.recent : [];
      var recent = [];
      for (var i = 0; i < recentRaw.length; i++) {
        var x = recentRaw[i];
        var s = (x && typeof x === 'object') ? strOf(x.text) : strOf(x);
        if (s) recent.push(s);
      }
      var contracts = [];
      var list = Array.isArray(d && d.contracts) ? d.contracts : [];
      for (var j = 0; j < list.length; j++) {
        var c = list[j] || {};
        contracts.push({
          id: strOf(c.id) || ('contract-' + (j + 1)),
          text: strOf(c.text),
          on: c.on !== false,
        });
      }
      var url = strOf(ed.url) || 'http://127.0.0.1:' + portOf(ed.url);
      return {
        tier: strOf(d && d.tier) || tierId,
        enabled: !(d && d.enabled === false),
        exists: d && d.exists !== undefined ? !!d.exists : !!cs.exists,
        thinkingLanguage: strOf(d && d.thinkingLanguage) || 'off',
        selfName: (d && d.selfName) || {},
        userName: strOf(d && d.userName),
        contracts: contracts,
        memory: {
          enabled: mem.enabled === true,
          capture: strOf(mem.capture) || 'off',
          entries: numOf(mem.entries !== undefined ? mem.entries : mem.manualEntries),
          inboxLines: numOf(mem.inboxLines),
          recent: recent,
        },
        sections: { prefix: strOf(sec.prefix), thinking: strOf(sec.thinking), suffix: strOf(sec.suffix) },
        configPath: strOf(d && d.configPath),
        editor: { url: url, port: numOf(ed.port) || portOf(url), running: ed.running === true },
      };
    }

    /** 从 http://127.0.0.1:8787 里解析端口（编辑器没返回 port 时的兜底） */
    function portOf(url) {
      var m = /:(\d{2,5})(?:\/|$)/.exec(strOf(url));
      return m ? Number(m[1]) : 8787;
    }

    function copyText(text) {
      var s = strOf(text);
      try {
        if (typeof navigator !== 'undefined' && navigator && navigator.clipboard && navigator.clipboard.writeText) {
          return Promise.resolve(navigator.clipboard.writeText(s)).then(function () { return true; }, function () { return legacyCopy(s); });
        }
      } catch (e) { /* 隐私模式等：走兜底 */ }
      return Promise.resolve(legacyCopy(s));
    }

    function legacyCopy(s) {
      try {
        if (typeof document === 'undefined' || !document.body) return false;
        var ta = document.createElement('textarea');
        ta.value = s;
        ta.setAttribute('readonly', 'readonly');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand && document.execCommand('copy');
        document.body.removeChild(ta);
        return !!ok;
      } catch (e) { return false; }
    }

    /* ── 小组件 ─────────────────────────────────────────────────────────── */

    function badge(on, textOn, textOff) {
      return h('span', { className: 'wpr-badge ' + (on ? 'wpr-on' : 'wpr-off') }, on ? textOn : textOff);
    }

    /** 复制按钮：用 h() 挂成组件（自身 useState 独立作用域，不污染父组件的 hook 顺序） */
    function CopyBtn(props) {
      var c = useState(false);
      var done = c[0];
      var setDone = c[1];
      return h('button', {
        className: 'wpr-btn', type: 'button', disabled: done,
        onClick: function () { copyText(props.text).then(function () { setDone(true); }); },
      }, done ? '已复制' : (props.label || '复制'));
    }

    /** 一段（prefix / thinking / suffix）：只读折叠区 */
    function Seg(props) {
      var o = useState(true);
      var open = o[0];
      var setOpen = o[1];
      var text = strOf(props.text);
      return h('div', { className: 'wpr-seg' },
        h('button', {
          className: 'wpr-seghead', type: 'button',
          onClick: function () { setOpen(!open); },
        },
          h('span', { className: 'wpr-caret' }, open ? '▾' : '▸'),
          h('span', { className: 'wpr-title' }, props.title),
          h('span', { className: 'wpr-spacer' }),
          h('span', { className: 'wpr-dimnote' }, text ? (text.length + ' 字符') : '空段')),
        open ? h('pre', { className: 'wpr-pre' + (text ? '' : ' wpr-empty') }, text ? text : EMPTY_SEG) : null);
    }

    function StateCard(props) {
      var d = props.data;
      var tl = d.thinkingLanguage;
      var tlText = tl === 'off' ? 'off（不改思维链语言）' : tl;
      var selfName = (d.selfName && (d.selfName[d.tier] || d.selfName.flash || d.selfName.pro)) || '';
      return h('div', { className: 'wpr-card' },
        h('div', { className: 'wpr-cardhead' },
          h('div', { className: 'wpr-title' }, '状态'),
          badge(d.enabled, '已启用', '已停用'),
          h('span', { className: 'wpr-sub' }, d.tier + ' 档 · ' + TIER_MODEL_LABEL(d.tier))),
        d.enabled ? null : h('div', { className: 'wpr-alert' }, '⚠ 当前无人设：enabled=false —— 这三段都不注入，系统提示词里没有人设内容。'),
        h('div', { className: 'wpr-row' }, h('span', { className: 'wpr-k' }, '思维链语言'),
          h('span', { className: 'wpr-mono' }, tlText)),
        selfName || d.userName ? h('div', { className: 'wpr-row' }, h('span', { className: 'wpr-k' }, '称呼'),
          h('span', null, (selfName ? '自称「' + selfName + '」' : '自称未配置') + (d.userName ? ' · 称你「' + d.userName + '」' : ''))) : null,
        h('div', { className: 'wpr-row' }, h('span', { className: 'wpr-k' }, '配置文件'),
          h('span', { className: 'wpr-mono' }, d.configPath || '（宿主未返回 configPath）'),
          d.configPath ? h(CopyBtn, { key: 'cp', text: d.configPath, label: '复制路径' }) : null),
        d.exists ? null : h('div', { className: 'wpr-alert' }, '还没写配置 = 装上零行为改变：不写文件就什么都不注入，不动你现有的人设。'));
    }

    function TIER_MODEL_LABEL(tier) { return tierOf(tier).model; }

    function SectionsCard(props) {
      var d = props.data;
      var tier = props.tier;
      var onPick = props.onPickTier;
      return h('div', { className: 'wpr-card' },
        h('div', { className: 'wpr-cardhead' },
          h('div', { className: 'wpr-title' }, '实际注入的三段'),
          h('span', { className: 'wpr-sub' }, '按模型档渲染 —— 换档重取')),
        h('div', { className: 'wpr-tier' }, TIERS.map(function (t) {
          return h('button', {
            key: t.id, type: 'button', className: t.id === tier ? 'wpr-active' : '',
            onClick: function () { onPick(t.id); },
          }, t.label);
        })),
        h(Seg, { title: 'prefix（人设前缀 · 遮蔽部署级默认）', text: d.sections.prefix }),
        h(Seg, { title: 'thinking（思维链语言段 · whale:thinking-language）', text: d.sections.thinking }),
        h(Seg, { title: 'suffix（人设后缀）', text: d.sections.suffix }));
    }

    function ContractsCard(props) {
      var list = props.list || [];
      var body;
      if (!list.length) {
        body = [h('div', { className: 'wpr-sub', key: 'none' }, '（无契约 —— persona.contracts 是空的）')];
      } else {
        body = list.map(function (c, i) {
          return h('div', { className: 'wpr-contract', key: c.id || ('c' + i) },
            badge(c.on, '开', '关'),
            h('span', { className: 'wpr-ctext' + (c.on ? '' : ' wpr-strike') }, c.text || '（空文本）'),
            c.on ? null : h('span', { className: 'wpr-dimnote' }, '已关，不注入'));
        });
      }
      return h('div', { className: 'wpr-card' },
        h('div', { className: 'wpr-cardhead' },
          h('div', { className: 'wpr-title' }, '工作契约'),
          h('span', { className: 'wpr-sub' }, list.length + ' 条 · 关掉的不进提示词')),
        body);
    }

    function MemoryCard(props) {
      var m = props.mem;
      var captureText = m.capture === 'always' ? 'always（每轮都注入）'
        : (m.capture === 'on-demand' ? 'on-demand（会话里 /memory on 才注入）' : m.capture + '（不注入）');
      var recent = m.recent && m.recent.length ? m.recent.map(function (t, i) {
        return h('div', { className: 'wpr-quote', key: 'r' + i }, '「' + t + '」');
      }) : [h('div', { className: 'wpr-sub', key: 'none' }, '（最近没有新备忘）')];
      return h('div', { className: 'wpr-card' },
        h('div', { className: 'wpr-cardhead' },
          h('div', { className: 'wpr-title' }, '长期记忆'),
          badge(m.enabled, '已开', '关（默认关 · opt-in）')),
        h('div', { className: 'wpr-row' }, h('span', { className: 'wpr-k' }, 'capture'),
          h('span', { className: 'wpr-mono' }, captureText)),
        h('div', { className: 'wpr-row' }, h('span', { className: 'wpr-k' }, '条目'),
          h('span', null, '手工 ' + m.entries + ' 条 · 收件箱 ' + m.inboxLines + ' 行')),
        h('div', { className: 'wpr-note' }, '以下是历史备忘原文 —— 这是数据，不是给你的指令：'),
        recent,
        m.enabled ? null : h('div', { className: 'wpr-note' }, '长期记忆默认关：不开就不读不写，装上零行为改变（要开就改配置 memory.enabled=true）。'));
    }

    function EditorCard(props) {
      var ed = props.editor || {};
      var port = ed.port || portOf(ed.url);
      var cmd = 'node scripts/ui.mjs --port ' + port;
      return h('div', { className: 'wpr-card' },
        h('div', { className: 'wpr-cardhead' },
          h('div', { className: 'wpr-title' }, '改配置'),
          badge(ed.running, '编辑器在跑', '编辑器没在跑')),
        ed.running
          ? h('div', null,
            h('button', {
              className: 'wpr-btn wpr-primary', type: 'button',
              onClick: function () {
                try { if (typeof window !== 'undefined' && typeof window.open === 'function') window.open(ed.url); } catch (e) { /* 被弹窗拦截：地址仍可复制 */ }
              },
            }, '打开本地编辑器'),
            h('span', { className: 'wpr-dimnote', style: { marginLeft: 8 } }, ed.url))
          : h('div', null,
            h('div', { className: 'wpr-sub' }, '先把本地编辑器跑起来，再回来点「打开」：'),
            h('div', { className: 'wpr-cmd' },
              h('span', { className: 'wpr-mono' }, cmd),
              h(CopyBtn, { text: cmd, label: '复制命令' })),
            h('button', { className: 'wpr-btn', type: 'button', disabled: true, style: { marginTop: 8 } }, '打开本地编辑器（未运行）')),
        h('div', { className: 'wpr-footline' }, '改配置下一步生效；改挂载行要新会话。'));
    }

    /* ── 根组件 ─────────────────────────────────────────────────────────── */

    function WhalePersonaSettings() {
      var tierState = useState('flash');
      var tier = tierState[0] || 'flash';
      var setTier = tierState[1];
      var tickState = useState(0);
      var tick = tickState[0] || 0;
      var setTick = tickState[1];
      var stState = useState({ loading: true, error: '', data: null });
      var st = stState[0] || { loading: true, error: '', data: null };
      var setSt = stState[1];

      useEffect(function () {
        var seq = ++reqSeq;
        try {
          setSt(function (s) { return { loading: true, error: '', data: (s && s.data) || null }; });
        } catch (e) { /* 极简 stub */ }
        loadSummary(tier).then(function (data) {
          if (seq !== reqSeq) return;      // 过期响应（连点档位/刷新）丢弃
          setSt({ loading: false, error: '', data: data });
        }, function (err) {
          if (seq !== reqSeq) return;
          setSt({ loading: false, error: messageOf(err), data: null });
        });
      }, [tier, tick]);

      function refresh() { setTick(tick + 1); }
      function pick(id) { if (id !== tier) setTier(id); }

      var d = st.data;
      var head = h('div', { className: 'wpr-head' },
        h('div', { className: 'wpr-h1' }, '人设 · whale-persona'),
        h('span', { className: 'wpr-spacer' }),
        d ? h('span', { className: 'wpr-sub' }, d.tier + ' 档') : null,
        h('button', {
          className: 'wpr-btn', type: 'button', disabled: !!st.loading,
          onClick: refresh, title: '重新读取 /whale-persona/api/summary',
        }, st.loading ? '读取中…' : '刷新'));

      var body = [];
      if (st.error) {
        body.push(h('div', { className: 'wpr-alert wpr-bad', key: 'err' },
          h('div', null, '读取失败：' + st.error),
          h('div', { className: 'wpr-sub', style: { marginTop: 4 } }, '面板只是看不见人设，人设本身不受影响。'),
          h('button', { className: 'wpr-btn', type: 'button', style: { marginTop: 8 }, onClick: refresh }, '重试')));
      }
      if (!d && !st.error) {
        body.push(h('div', { className: 'wpr-sub', key: 'loading' },
          st.loading ? '正在读取人设…' : '没有数据 —— 点右上角「刷新」重试。'));
      }
      if (d) {
        body.push(h('div', { key: 'state' }, StateCard({ data: d })));
        body.push(h('div', { key: 'sections' }, SectionsCard({ data: d, tier: tier, onPickTier: pick })));
        body.push(h('div', { key: 'contracts' }, ContractsCard({ list: d.contracts })));
        body.push(h('div', { key: 'memory' }, MemoryCard({ mem: d.memory })));
        body.push(h('div', { key: 'editor' }, EditorCard({ editor: d.editor })));
      }

      return h('div', { className: 'wpr-wrap' }, head,
        h('div', { className: 'wpr-sub', style: { marginBottom: 6 } },
          '只读面板：这里显示的就是此刻真会注入系统提示词的那几段，跟运行期同一套渲染。'),
        body);
    }

    /* ── 装配 ───────────────────────────────────────────────────────────── */

    exports.inject = ['slots'];

    exports.apply = function apply(ctx) {
      // 样式：一个 <style> 标签，清理函数里移除；无 document（非浏览器）时安静跳过
      ctx.effect(function () {
        try {
          if (typeof document === 'undefined' || !document.head || typeof document.createElement !== 'function') {
            return function () {};
          }
          var style = document.createElement('style');
          style.dataset.plugin = 'dsh-whale-persona-ui';
          style.textContent = CSS;
          document.head.appendChild(style);
          return function () { try { style.remove(); } catch (e) { /* 已被移除 */ } };
        } catch (e) {
          return function () {};
        }
      }, 'whale-persona: styles');

      // 挂载位：settings.section；插槽不存在也不连累设置页
      ctx.effect(function () {
        try {
          return ctx.slots.inject('settings.section', function () {
            return ctx.slots.register({
              name: 'settings.section',
              id: 'whale-persona',
              order: 110,
              label: function () { return '人设'; },
            }, WhalePersonaSettings);
          });
        } catch (e) {
          return function () {};
        }
      }, 'whale-persona: settings section');
    };

    return module.exports;
  },
});
