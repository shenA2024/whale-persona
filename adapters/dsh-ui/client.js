/**
 * @shenA2024/whale-persona-ui —— 设置面板（浏览器半身 · 可编辑版）
 *
 * 手写懒 CJS bundle，零依赖零构建：宿主只认「已构建的 __ModuleLoader__ bundle」这个契约，
 * require 只能命中基座模块（react 在里面），所以用 createElement 手写组件——
 * 改一行保存、刷新页面就生效，没有编译步骤，不联网，不引任何第三方。
 *
 * 挂载位：settings.section（官方给仓库外插件预留的整页设置位）。
 * 面板**可编辑**：改动先落在本地 state，只有点「保存」才发一次 POST。
 *
 * 数据来源（宿主半身 adapters/dsh-ui/index.js，两条路由）：
 *   GET  /whale-persona/api/summary?tier=flash|pro
 *        → raw（磁盘原始对象，含未知键）/ defaults / configValid / warnings
 *          / sections（三段预览）/ contracts / memory / editor …
 *   POST /whale-persona/api/config   body { config: patch }
 *        → 服务端**整体读改写**：patch 里出现的段整体替换，未知键原样保留。
 *          所以发出去的 persona / memory 必须**基于 summary.raw 展开**再覆盖改动字段，
 *          只发改掉的字段会把用户其它设置抹掉（这是本面板最容易犯的错）。
 *          200 → { ok, preview:{prefix,thinking,suffix,warnings}, savedAt, … }
 *          409 → 磁盘上是坏 JSON，拒绝覆盖；415/400 → 请求格式不对。
 *
 * 兜底：老版本宿主没有 raw 时用 defaults 铺表单、禁用保存（提示改用本地编辑器）。
 * 失败路径（网络异常 / 非 2xx / 非 JSON）一律降级成一行可读错误，绝不崩掉设置页。
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

    var SUMMARY_API = '/whale-persona/api/summary';
    var CONFIG_API = '/whale-persona/api/config';
    /** 面板看到的三段是按模型档渲染的：切换档位即带参数重新 fetch */
    /** 预览档位：面板只认档位 id 与标签，**不持有任何具体模型 id**（用户用 GLM/grok 时看到 deepseek 很怪）；
     *  预览请求的 model 参数由 summary.model 提供（宿主不认识它也无所谓）。 */
    var TIERS = [
      { id: 'flash', label: 'flash 档' },
      { id: 'pro', label: 'pro 档' },
    ];
    var EMPTY_SEG = '（空 —— 这一段不会出现在系统提示词里）';
    var THINKING_PRESETS = ['off', 'zh-CN', 'en'];
    /** 保存策略提示：宿主不认识 raw 时用 defaults 铺表单、禁用保存 */
    var NO_RAW_HINT = '宿主版本不支持在设置页保存，请用本地编辑器';

    /** hooks 兜底：宿主基座 shim 不完整时降级成「静态渲染」，不连累设置页 */
    var useState = typeof React.useState === 'function' ? React.useState : function (v) { return [v, function () {}]; };
    var useEffect = typeof React.useEffect === 'function' ? React.useEffect : function () {};
    var useRef = typeof React.useRef === 'function' ? React.useRef : function (v) { return { current: v }; };
    var useCallback = typeof React.useCallback === 'function' ? React.useCallback : function (f) { return f; };
    /** 请求序号：档位连点时丢弃过期响应（不依赖 effect 清理函数，stub 环境也成立） */
    var reqSeq = 0;
    /** 上一次 summary 给的模型名：只用于预览请求的参数，**不在界面上显示** */
    var lastModel = '';

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
      '.wpr-btn.wpr-dirty{border-color:rgba(76,141,255,.85);background:rgba(76,141,255,.30);color:#fff;font-weight:600}',
      '.wpr-btn.wpr-primary.wpr-dirty:hover:not([disabled]){background:rgba(76,141,255,.42)}',
      '.wpr-btn.wpr-icon{padding:1px 7px;line-height:16px}',
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
      '.wpr-alert{border:1px solid rgba(229,160,75,.45);background:rgba(229,160,75,.12);color:#e8b071;border-radius:6px;padding:6px 10px;margin:8px 0}',
      '.wpr-alert.wpr-bad{border-color:rgba(229,83,75,.5);background:rgba(229,83,75,.12);color:#f08a84}',
      '.wpr-alert.wpr-ok{border-color:rgba(63,185,80,.5);background:rgba(63,185,80,.12);color:#8fe3ad}',
      '.wpr-tier{display:inline-flex;border:1px solid rgba(127,127,127,.3);border-radius:999px;overflow:hidden;background:rgba(127,127,127,.06)}',
      '.wpr-tier button{background:transparent;border:0;color:inherit;font:inherit;font-size:12px;padding:2px 12px;cursor:pointer}',
      '.wpr-tier button.wpr-active{background:rgba(76,141,255,.22);color:#eaf2ff}',
      '.wpr-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;position:sticky;top:0;z-index:2;',
      'padding:8px 0;background:var(--dsw-alias-bg-1,rgba(20,20,22,.92));border-bottom:1px solid rgba(127,127,127,.2)}',
      '.wpr-field{display:flex;gap:10px;align-items:flex-start;margin:8px 0}',
      '.wpr-flabel{flex:0 0 132px;color:var(--dsw-alias-text-2,#9aa0a6);font-size:12px;padding-top:4px}',
      '.wpr-fbody{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:3px}',
      '.wpr-in,.wpr-ta,.wpr-sel{width:100%;box-sizing:border-box;background:rgba(127,127,127,.10);color:inherit;font:inherit;',
      'font-size:12px;border:1px solid rgba(127,127,127,.34);border-radius:6px;padding:4px 8px;outline:none}',
      '.wpr-in:focus,.wpr-ta:focus,.wpr-sel:focus{border-color:rgba(76,141,255,.7)}',
      '.wpr-ta{min-height:96px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;line-height:1.6}',
      '.wpr-in:disabled,.wpr-ta:disabled,.wpr-sel:disabled{opacity:.5;cursor:not-allowed}',
      '.wpr-hint{color:var(--dsw-alias-text-2,#9aa0a6);font-size:11px}',
      '.wpr-warn{color:#e8b071;font-size:11px}',
      '.wpr-chk{display:inline-flex;align-items:center;gap:6px;cursor:pointer;user-select:none}',
      '.wpr-map-row{display:flex;gap:8px;align-items:center;padding:5px 0;border-top:1px solid rgba(127,127,127,.22)}',
      '.wpr-map-row:first-of-type{border-top:0}',
      '.wpr-map-row .wpr-in{flex:1 1 0;min-width:0}',
      '.wpr-arrow{color:var(--dsw-alias-text-2,#9aa0a6);flex:0 0 auto}',
      '.wpr-contract{display:flex;gap:8px;align-items:flex-start;padding:5px 0;border-top:1px solid rgba(127,127,127,.22)}',
      '.wpr-contract:first-of-type{border-top:0}',
      '.wpr-ctext{flex:1;min-width:0;white-space:pre-wrap;word-break:break-word}',
      '.wpr-strike{opacity:.62}',
      '.wpr-dimnote{color:var(--dsw-alias-text-2,#9aa0a6);font-size:11px;white-space:nowrap}',
      '.wpr-note{color:var(--dsw-alias-text-2,#9aa0a6);font-size:11px;margin:6px 0 2px}',
      '.wpr-quote{border-left:2px solid rgba(127,127,127,.38);padding:2px 0 2px 8px;margin:4px 0;',
      'color:var(--dsw-alias-text-2,#9aa0a6);white-space:pre-wrap;word-break:break-word}',
      '.wpr-cmd{display:inline-flex;align-items:center;gap:8px;margin-top:8px;padding:4px 10px;border:1px dashed rgba(127,127,127,.42);border-radius:6px}',
      '.wpr-seg{border:1px solid rgba(127,127,127,.25);border-radius:6px;margin:8px 0;overflow:hidden;background:rgba(127,127,127,.05)}',
      '.wpr-seghead{display:flex;align-items:center;gap:8px;width:100%;padding:6px 10px;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;text-align:left}',
      '.wpr-seghead:hover{background:rgba(127,127,127,.10)}',
      '.wpr-caret{font-size:9px;opacity:.7;width:10px;flex:none}',
      '.wpr-pre{margin:0;padding:8px 10px;border-top:1px solid rgba(127,127,127,.25);max-height:280px;overflow:auto;',
      'white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;',
      'font-size:12px;line-height:1.6;user-select:text;-webkit-user-select:text}',
      '.wpr-empty{color:var(--dsw-alias-text-2,#9aa0a6);font-style:italic}',
      '.wpr-off{opacity:.62}',
      '.wpr-footline{margin-top:14px;color:var(--dsw-alias-text-2,#9aa0a6);font-size:11px}',
    ].join('');

    /* ── 取数 ───────────────────────────────────────────────────────────── */

    function messageOf(e) {
      if (!e) return '未知错误';
      return String((e && e.message) || e);
    }

    function loadSummary(tier) {
      var t = tierOf(tier);
      var url = SUMMARY_API + '?tier=' + encodeURIComponent(t.id) + (lastModel ? '&model=' + encodeURIComponent(lastModel) : '');
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

    /** 保存：唯一写入口。patch 已由 buildPatch 基于 raw 展开，这里只负责发与解读响应 */
    function saveConfig(patch) {
      if (typeof fetch !== 'function') return Promise.reject(new Error('环境里没有 fetch'));
      var p;
      try {
        p = Promise.resolve(fetch(CONFIG_API, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ config: patch }),
        }));
      } catch (e) {
        return Promise.reject(new Error(messageOf(e)));
      }
      return p.then(readBody).then(function (res) {
        var data = res && res.data;
        if (res && typeof res.status === 'number' && (res.status < 200 || res.status >= 300)) {
          // 服务端 error 原文优先（409 坏 JSON / 415 类型不对 / 400 体不合法）
          throw new Error('HTTP ' + res.status + (data && data.error ? '：' + data.error : ''));
        }
        if (!data || typeof data !== 'object') throw new Error('返回内容不是 JSON');
        if (data.ok === false) throw new Error(String(data.error || '保存失败：接口返回 ok=false'));
        return data;
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

    function objOf(v) {
      return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
    }

    function arrOf(v) { return Array.isArray(v) ? v : []; }

    /** 三段 + 告警：读接口（sections/warnings）与写接口（preview）两种来源收敛成一种形状 */
    function segmentsOf(src, warnings) {
      var s = objOf(src);
      return {
        sections: { prefix: strOf(s.prefix), thinking: strOf(s.thinking), suffix: strOf(s.suffix) },
        warnings: arrOf(warnings).map(strOf).filter(function (t) { return !!t; }),
      };
    }

    /** 把两种口径的响应收敛成一种形状：面板渲染只认这里 */
    function normalize(d, tierId) {
      var mem = objOf(d && d.memory);
      var cs = objOf(d && d.configState);
      var ed = objOf(d && d.editor);
      var seg = segmentsOf(d && d.sections, d && d.warnings);
      var recentRaw = arrOf(mem.recent);
      var recent = [];
      for (var i = 0; i < recentRaw.length; i++) {
        var x = recentRaw[i];
        var s = (x && typeof x === 'object') ? strOf(x.text) : strOf(x);
        if (s) recent.push(s);
      }
      var contracts = [];
      var list = arrOf(d && d.contracts);
      for (var j = 0; j < list.length; j++) {
        var c = objOf(list[j]);
        contracts.push({
          id: strOf(c.id) || ('contract-' + (j + 1)),
          text: strOf(c.text),
          on: c.on !== false,
        });
      }
      // 语气预设（0.9.0）：宿主从 core/presets.js 下发（唯一一份文案）；坏条目直接丢 ——
      // 按钮点了没反应，好过让整块设置页崩掉
      var presets = [];
      var plist = arrOf(d && d.tonePresets);
      for (var pi = 0; pi < plist.length; pi++) {
        var pr = objOf(plist[pi]);
        var ptext = strOf(pr.text);
        if (!ptext) continue;
        var pid = strOf(pr.id) || ('preset-' + (pi + 1));
        presets.push({ id: pid, label: strOf(pr.label) || pid, text: ptext });
      }
      var raw = objOf(d && d.raw);
      // 有 raw（哪怕空对象）＝ 新宿主：能整体回写；raw 不是对象（老宿主没这字段 / 坏 JSON 时为 null）＝ 不能写
      var hasRaw = !!(d && d.raw !== undefined && d.raw !== null && typeof d.raw === 'object' && !Array.isArray(d.raw));
      var url = strOf(ed.url) || 'http://127.0.0.1:' + portOf(ed.url);
      lastModel = strOf(d && d.model) || lastModel;   // 只喂预览请求参数，不显示
      return {
        tier: strOf(d && d.tier) || tierId,
        // 档位标签/判定规则一律用宿主给的原话，前端不硬编码（换模型供应商时文案不用改前端）
        tierLabel: strOf(d && d.tierLabel),
        tierRule: strOf(d && d.tierRule),
        selfNameByModel: objOf(d && d.selfNameByModel),
        tonePresets: presets,
        // 宿主上一次真实注入用的模型 id（界面上的模型显示名通常不是它，见 core/lastModel.js）
        seenModel: strOf(d && d.lastModel),
        enabled: !(d && d.enabled === false),
        exists: d && d.exists !== undefined ? !!d.exists : !!cs.exists,
        thinkingLanguage: strOf(d && d.thinkingLanguage) || 'off',
        selfName: objOf(d && d.selfName),
        userName: strOf(d && d.userName),
        stance: strOf(d && d.stance),
        character: strOf(d && d.character),
        suffix: strOf(d && d.suffix),
        contracts: contracts,
        memory: {
          enabled: mem.enabled === true,
          inbox: mem.inbox !== false,
          capture: strOf(mem.capture) || 'on-demand',
          captureNow: mem.captureNow === true,
          entries: numOf(mem.entries !== undefined ? mem.entries : mem.manualEntries),
          maxEntries: numOf(mem.maxEntries),
          inboxLines: numOf(mem.inboxLines),
          recent: recent,
        },
        warnings: seg.warnings,
        sections: seg.sections,
        configPath: strOf(d && d.configPath),
        configState: { exists: !!cs.exists, bytes: numOf(cs.bytes), mtimeMs: numOf(cs.mtimeMs) },
        defaults: objOf(d && d.defaults),
        raw: raw,
        hasRaw: hasRaw,
        // 注意：raw:null 与 configValid:false 是两件事 —— 老宿主（没这个字段）＝ raw 缺失、
        // configValid 缺省 true；磁盘坏 JSON ＝ configValid 显式 false。两者都禁用保存。
        configValid: d && d.configValid !== undefined ? d.configValid !== false : true,
        editor: { url: url, port: numOf(ed.port) || portOf(url), running: ed.running === true },
      };
    }

    /** 从 http://127.0.0.1:8787 里解析端口（编辑器没返回 port 时的兜底） */
    function portOf(url) {
      var m = /:(\d{2,5})(?:\/|$)/.exec(strOf(url));
      return m ? Number(m[1]) : 8787;
    }

    /* ── 表单数据 ───────────────────────────────────────────────────────── */

    /**
     * 表单形状（扁平 + 数组）——渲染层只认这里，raw / defaults 的差异全部在这一层抹平。
     * 保存时再摊回 persona / memory：以 raw 展开（未知键原样带上）后覆盖改动字段。
     */
    function formFrom(n, hasRawOverride) {
      var raw = n.raw;
      var def = n.defaults;
      var hasRaw = hasRawOverride !== undefined ? !!hasRawOverride : !!(n.hasRaw || (n.raw && typeof n.raw === 'object'));
      var rp = objOf(raw.persona);
      var rm = objOf(raw.memory);
      var dp = objOf(def.persona);
      var dm = objOf(def.memory);
      var contractsRaw = Array.isArray(rp.contracts) ? rp.contracts : arrOf(dp.contracts);
      var contracts = [];
      for (var i = 0; i < contractsRaw.length; i++) {
        var c = objOf(contractsRaw[i]);
        // 保留条目上的未知键（id 等），只把 text / on 提成可编辑字段
        var keep = {};
        for (var k in c) if (Object.prototype.hasOwnProperty.call(c, k) && k !== 'text' && k !== 'on') keep[k] = c[k];
        contracts.push({ keep: keep, text: strOf(c.text), on: c.on !== false });
      }
      var entriesRaw = Array.isArray(rm.entries) ? rm.entries : arrOf(dm.entries);
      var entries = [];
      for (var j = 0; j < entriesRaw.length; j++) {
        var e = objOf(entriesRaw[j]);
        var keep2 = {};
        for (var k2 in e) if (Object.prototype.hasOwnProperty.call(e, k2) && k2 !== 'text' && k2 !== 'on') keep2[k2] = e[k2];
        entries.push({ keep: keep2, text: strOf(e.text), on: e.on !== false });
      }
      // 老宿主没有 raw 时：先拿 summary 顶层的**当前生效值**补位（面板显示的仍是真状态），
      // 最末才回落出厂默认。注意这条路径保存是禁用的（没有 raw 就不能整体回写）。
      var selfName = objOf(n.selfName);
      var curFlash = strOf(selfName.flash);
      var curPro = strOf(selfName.pro);
      var curUser = strOf(n.userName);
      var curContracts = arrOf(n.contracts).map(function (c) {
        return { keep: { id: strOf(objOf(c).id) }, text: strOf(objOf(c).text), on: objOf(c).on !== false };
      });
      if (!hasRaw) {
        if (!contracts.length && curContracts.length) contracts = curContracts;
      }
      // 形象 / 语气（0.9.0）：与自称同一套读取次序 —— 磁盘 raw 优先，无 raw 时回落出厂默认
      var appearance = styleForm(hasRaw ? rp.appearance : dp.appearance);
      var tone = styleForm(hasRaw ? rp.tone : dp.tone);
      return {
        enabled: raw.enabled !== undefined ? raw.enabled !== false : (n.enabled !== undefined ? n.enabled !== false : (def.enabled !== false)),
        thinkingLanguage: strOf(raw.thinkingLanguage !== undefined ? raw.thinkingLanguage : (n.thinkingLanguage !== undefined ? n.thinkingLanguage : def.thinkingLanguage)) || 'off',
        selfNameFlash: strOf(rp.selfNameFlash !== undefined ? rp.selfNameFlash : (curFlash || dp.selfNameFlash)),
        selfNamePro: strOf(rp.selfNamePro !== undefined ? rp.selfNamePro : (curPro || dp.selfNamePro)),
        userName: strOf(rp.userName !== undefined ? rp.userName : (curUser || dp.userName)),
        stance: strOf(rp.stance !== undefined ? rp.stance : (hasRaw ? dp.stance : strOf(n.stance) || dp.stance)),
        character: strOf(rp.character !== undefined ? rp.character : (hasRaw ? dp.character : strOf(n.character) || dp.character)),
        suffix: strOf(rp.suffix !== undefined ? rp.suffix : (hasRaw ? dp.suffix : strOf(n.suffix) || dp.suffix)),
        contracts: contracts,
        selfNameRows: selfNameTable(hasRaw ? rp.selfNameByModel : objOf(dp.selfNameByModel)).rows,
        selfNameKeep: selfNameTable(hasRaw ? rp.selfNameByModel : objOf(dp.selfNameByModel)).keep,
        appearanceEnabled: appearance.enabled,
        appearanceText: appearance.text,
        appearanceRows: appearance.rows,
        appearanceKeep: appearance.keep,
        toneEnabled: tone.enabled,
        toneText: tone.text,
        toneRows: tone.rows,
        toneKeep: tone.keep,
        memoryEnabled: rm.enabled !== undefined ? rm.enabled === true : dm.enabled === true,
        memoryCapture: strOf(rm.capture !== undefined ? rm.capture : dm.capture) || 'on-demand',
        entries: entries,
      };
    }

    /**
     * persona.selfNameByModel（普通对象）→ 可编辑行 + 原表快照。
     * keep 是**原始对象本身**：值不是标量的怪条目留在快照里原样回写，不在界面上暴露也不会被抹掉。
     */
    function selfNameTable(table) {
      var src = objOf(table);
      var rows = [];
      var keep = {};
      for (var k in src) {
        if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
        var v = src[k];
        if (v && typeof v === 'object') { keep[k] = v; continue }   // 非标量值：只进 keep，不给编辑行
        rows.push({ keep: { key: strOf(k) }, key: strOf(k), value: strOf(v) });
      }
      return { rows: rows, keep: keep };
    }

    /**
     * 「开关 + 通用文本 + 按模型覆盖表」这一族字段（形象 / 语气，0.9.0）的表单展开。
     * 两者配置形状相同（{ enabled, text, byModel }，未知子键原样保留），所以共用一份展开；
     * 与 core/defaults.js 的 styleField() 同一口径：坏形状一律回落成「关 + 空」，绝不抛错。
     */
    function styleForm(src) {
      var s = objOf(src);
      var table = selfNameTable(s.byModel);   // 通用的按模型映射表（名字为兼容测试钩子保留，不改）
      return { enabled: s.enabled === true, text: strOf(s.text), rows: table.rows, keep: table.keep };
    }

    /**
     * 「按模型指定自称」的行 → 普通对象（先铺原始快照，再覆盖界面上编辑过的标量条目）。
     * 空键或空值的行直接丢弃：用户点了「+ 加一条」还没填就保存，不该往配置里塞空条目。
     */
    function selfNameOut(items, keepSrc) {
      var out = {};
      // keep 里只可能是「非标量怪条目」：标量条目一律由界面上的行表达，
      // 否则用户删掉一行后，旧值会从快照里复活（本机实测到过这个回魂 bug）。
      var src = objOf(keepSrc);
      for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) out[k] = src[k];
      var list = arrOf(items);
      for (var i = 0; i < list.length; i++) {
        var it = list[i] || {};
        var key = strOf(it.key).trim();
        var val = strOf(it.value).trim();
        if (!key || !val) continue;
        out[key] = val;
      }
      return out;
    }

    /**
     * 形象 / 语气：表单 → 配置对象。
     * **先摊开 raw 里已有的同名对象，再覆盖** enabled / text / byModel ——
     * 未知子键（别的工具或未来版本写进去的）不许在保存时被裁掉（本仓硬纪律，与 persona 整体回写同一口径）。
     */
    function styleOut(enabled, text, rows, keepSrc, rawField) {
      var out = {};
      var src = objOf(rawField);
      for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) out[k] = src[k];
      out.enabled = enabled === true;
      out.text = strOf(text);
      out.byModel = selfNameOut(arrOf(rows), keepSrc);
      return out;
    }

    /** 摊回 { id?, text, on }：id 与其它未知键原样带回 */
    function contractOut(items) {
      var out = [];
      for (var i = 0; i < items.length; i++) {
        var it = items[i] || {};
        var o = {};
        for (var k in objOf(it.keep)) if (Object.prototype.hasOwnProperty.call(it.keep, k)) o[k] = it.keep[k];
        o.text = strOf(it.text);
        o.on = it.on !== false;
        out.push(o);
      }
      return out;
    }

    function entryOut(items) {
      var out = [];
      for (var i = 0; i < items.length; i++) {
        var it = items[i] || {};
        var o = {};
        for (var k in objOf(it.keep)) if (Object.prototype.hasOwnProperty.call(it.keep, k)) o[k] = it.keep[k];
        o.text = strOf(it.text);
        o.on = it.on !== false;
        out.push(o);
      }
      return out;
    }

    /**
     * POST body 的 config：四个已知段。
     * 关键：persona / memory **基于 raw 展开**再覆盖 —— 服务端整段替换，
     * 只发改掉的字段会把用户的 preset / inbox / maxEntries / inboxPath 等其它设置抹掉。
     */
    function buildPatch(form, n) {
      // raw 理论上有值（没值＝保存按钮禁用），但这里仍用 objOf 兜一层：
      // 任何形状都不该让「保存」抛错，宁可发一份只有已知段的 patch。
      var persona = {};
      var rawP = objOf(objOf(n.raw).persona);
      for (var k in rawP) if (Object.prototype.hasOwnProperty.call(rawP, k)) persona[k] = rawP[k];
      persona.selfNameFlash = form.selfNameFlash;
      persona.selfNamePro = form.selfNamePro;
      persona.userName = form.userName;
      persona.stance = form.stance;
      persona.character = form.character;
      persona.suffix = form.suffix;
      // 这几处都过 arrOf：任何形状的表单都不该让「保存」抛错（宁可少发一个键，也不弹一行红字）
      persona.contracts = contractOut(arrOf(form.contracts));
      persona.selfNameByModel = selfNameOut(arrOf(form.selfNameRows), form.selfNameKeep);
      // 形象 / 语气：**先展开 raw 里的同名对象再覆盖**这三个已知子键（未知子键照旧不许被裁掉）
      persona.appearance = styleOut(form.appearanceEnabled, form.appearanceText, form.appearanceRows, form.appearanceKeep, rawP.appearance);
      persona.tone = styleOut(form.toneEnabled, form.toneText, form.toneRows, form.toneKeep, rawP.tone);

      var memory = {};
      var rawM = objOf(objOf(n.raw).memory);
      for (var k2 in rawM) if (Object.prototype.hasOwnProperty.call(rawM, k2)) memory[k2] = rawM[k2];
      memory.enabled = form.memoryEnabled === true;
      memory.capture = form.memoryCapture;
      memory.entries = entryOut(arrOf(form.entries));

      return {
        enabled: form.enabled === true,
        thinkingLanguage: form.thinkingLanguage,
        persona: persona,
        memory: memory,
      };
    }

    function makeContract() { return { keep: {}, text: '', on: true }; }

    /** 映射表的三个表单 key（自称 / 形象 / 语气）：行形状都是 { keep, key, value }，不是契约的 { keep, text, on } */
    var MAP_ROW_KEYS = ['selfNameRows', 'appearanceRows', 'toneRows'];

    /** 新行的初值：契约/条目用 text，映射表用 key/value（都是空串，等用户填） */
    function makeRow(key, seed) {
      // seed：按模型表的新行预填关键词（调用点传宿主真实模型 id，用户少猜一次）
      if (MAP_ROW_KEYS.indexOf(key) >= 0) return { keep: {}, key: strOf(seed), value: '' };
      return makeContract();
    }

    /**
     * 保存成功后的表单重派生：拿服务端返回的**实际落盘 config** 重新展开一遍表单。
     * 为什么不直接把 patch 当新表单：服务端会补齐/回落默认值（自称为空回落「我」等），
     * 面板要显示的是磁盘上真实生效的值，否则「N 条」这类派生数字会跟落盘结果对不上。
     * config 缺失时退回 patch 本身（形状一致，只是少了服务端回落）。
     */
    function rebaseForm(n, saved, patch) {
      var cfg = (saved && typeof saved === 'object' && !Array.isArray(saved)) ? saved : patch;
      return formFrom({
        raw: cfg,
        defaults: n.defaults,
      });
    }

    /** 未保存判定：与「上一次服务端确认过的表单」逐字节比 */
    function sameForm(a, b) {
      if (!a || !b) return false;
      try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; }
    }

    function nowLabel() {
      var d = new Date();
      function p(x) { return (x < 10 ? '0' : '') + x; }
      return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
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

    /* ── 小组件（全部 h() 挂载：条件渲染里直接调函数会改 hook 顺序） ─────── */

    function badge(on, textOn, textOff) {
      return h('span', { className: 'wpr-badge ' + (on ? 'wpr-on' : 'wpr-off') }, on ? textOn : textOff);
    }

    /** 复制按钮：useState 独立作用域，不污染父组件的 hook 顺序 */
    function CopyBtn(props) {
      var c = useState(false);
      var done = c[0];
      var setDone = c[1];
      return h('button', {
        className: 'wpr-btn', type: 'button', disabled: done,
        onClick: function () { copyText(props.text).then(function () { setDone(true); }); },
      }, done ? '已复制' : (props.label || '复制'));
    }

    function Field(props) {
      return h('div', { className: 'wpr-field' },
        h('label', { className: 'wpr-flabel' }, props.label),
        h('div', { className: 'wpr-fbody' }, props.children));
    }

    function CheckBox(props) {
      return h('label', { className: 'wpr-chk' },
        h('input', {
          type: 'checkbox', checked: props.checked === true, disabled: !!props.disabled,
          onChange: function (ev) { props.onChange(!!(ev && ev.target && ev.target.checked)); },
        }),
        h('span', null, props.label));
    }

    function TextInput(props) {
      function change(ev) { props.onChange(strOf(ev && ev.target && ev.target.value)); }
      if (props.multiline) {
        return h('textarea', {
          className: 'wpr-ta', value: props.value, disabled: !!props.disabled,
          spellCheck: false, placeholder: props.placeholder || '', onChange: change,
        });
      }
      return h('input', {
        className: 'wpr-in', type: 'text', value: props.value, disabled: !!props.disabled,
        spellCheck: false, placeholder: props.placeholder || '', onChange: change,
      });
    }

    /**
     * 思维链语言：下拉 + 允许自定义输入。
     * 原生 datalist 正好是这个语义（选项可选、也能直接敲），一个受控 input 就够了。
     * datalist 需要 id + list 关联，手写 createElement 下用 ref 补挂 setAttribute。
     */
    function TextInputWithList(props) {
      var ref = useRef(null);
      useEffect(function () {
        var el = ref.current;
        if (el && typeof el.setAttribute === 'function') el.setAttribute('list', props.listId);
      }, [props.listId]);
      function change(ev) { props.onChange(strOf(ev && ev.target && ev.target.value)); }
      return h('input', {
        ref: ref, className: 'wpr-in', type: 'text', value: props.value, disabled: !!props.disabled,
        spellCheck: false, placeholder: props.placeholder || '', onChange: change,
      });
    }

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
      var tl = props.thinkingLanguage;
      var tlText = tl === 'off' ? 'off（不改思维链语言）' : tl;
      var st = d.configState || {};
      var label = strOf(d.tierLabel) || (d.tier + ' 档');   // 老宿主没这个字段时用档位 id 兜底，仍然不显示模型 id
      var size = st.exists ? (st.bytes + ' 字节') : '文件不存在（装上零行为改变）';
      return h('div', { className: 'wpr-card' },
        h('div', { className: 'wpr-cardhead' },
          h('div', { className: 'wpr-title' }, '状态'),
          badge(props.enabled, '已启用', '已停用'),
          // 只显示档位标签（summary.tierLabel），不显示具体模型 id
          h('span', { className: 'wpr-sub' }, '档位：' + label)),
        props.enabled ? null : h('div', { className: 'wpr-alert' }, '⚠ 当前无人设：enabled=false —— 这三段都不注入，系统提示词里没有人设内容。'),
        h('div', { className: 'wpr-row' }, h('span', { className: 'wpr-k' }, '思维链语言'), h('span', { className: 'wpr-mono' }, tlText)),
        h('div', { className: 'wpr-row' }, h('span', { className: 'wpr-k' }, '配置文件'),
          h('span', { className: 'wpr-mono' }, d.configPath || '（宿主未返回 configPath）'),
          d.configPath ? h(CopyBtn, { key: 'cp', text: d.configPath, label: '复制路径' }) : null),
        h('div', { className: 'wpr-row' }, h('span', { className: 'wpr-k' }, '文件'),
          h('span', { className: 'wpr-sub' }, size)),
        st.exists ? null : h('div', { className: 'wpr-alert' }, '还没写配置 = 装上零行为改变：不写文件就什么都不注入，不动你现有的人设。'));
    }

    function Toolbar(props) {
      var disabled = !!props.disabled;
      return h('div', { className: 'wpr-toolbar' },
        h('span', { className: 'wpr-dimnote' }, '预览档位'),
        h('div', {
          className: 'wpr-tier',
          title: '只影响下面的三段预览，保存的内容跟它无关',
        }, TIERS.map(function (t) {
          return h('button', {
            key: t.id, type: 'button', disabled: disabled,
            className: t.id === props.tier ? 'wpr-active' : '',
            onClick: function () { props.onPickTier(t.id); },
          }, t.label);
        })),
        h('span', { className: 'wpr-dimnote' }, '只影响下面的三段预览，保存的内容跟它无关'),
        h('button', {
          className: 'wpr-btn', type: 'button', disabled: disabled || !!props.loading,
          onClick: props.onRefresh, title: '丢弃未保存改动，重新读取 /whale-persona/api/summary',
        }, props.loading ? '读取中…' : '刷新'),
        h('button', {
          className: 'wpr-btn wpr-primary' + (props.dirty ? ' wpr-dirty' : ''), type: 'button',
          disabled: disabled || !!props.saving,
          onClick: props.onSave,
        }, props.saving ? '保存中…' : '保存'),
        h('span', { className: 'wpr-spacer' }),
        h('span', { className: 'wpr-dimnote' }, props.dirty ? '有未保存的改动' : '无未保存改动'));
    }

    function Banner(props) {
      var st = props.status;
      var items = [];
      if (st.error) items.push(h('div', { className: 'wpr-alert wpr-bad', key: 'e' }, '保存失败：' + st.error));
      if (st.saved) {
        items.push(h('div', { className: 'wpr-alert wpr-ok', key: 's' },
          '已保存 · 改配置下一步生效' + (st.savedAt ? '（保存时间 ' + st.savedAt + '）' : '')));
      }
      if (props.notes && props.notes.length) {
        for (var i = 0; i < props.notes.length; i++) {
          items.push(h('div', { className: 'wpr-alert', key: 'n' + i }, props.notes[i]));
        }
      }
      return items.length ? h('div', null, items) : null;
    }

    function SectionsCard(props) {
      var sec = props.sections || {};
      return h('div', { className: 'wpr-card' },
        h('div', { className: 'wpr-cardhead' },
          h('div', { className: 'wpr-title' }, '实际注入的三段'),
          h('span', { className: 'wpr-sub' },
            props.fromSave ? '已按服务端返回的就地更新 · ' + props.tier + ' 档' : '按模型档渲染 —— 换档重取')),
        h(Seg, { title: 'prefix（人设前缀 · 遮蔽部署级默认）', text: sec.prefix }),
        h(Seg, { title: 'thinking（思维链语言段 · whale:thinking-language）', text: sec.thinking }),
        h(Seg, { title: 'suffix（人设后缀）', text: sec.suffix }));
    }

    function ContractsCard(props) {
      var list = arrOf(props.value);   // 兜底成数组：任何非数组都不许把整块设置页带崩
      var rows = list.map(function (c, i) {
        return h('div', { className: 'wpr-contract', key: 'c' + i },
          h('label', { className: 'wpr-chk' },
            h('input', {
              type: 'checkbox', checked: c.on !== false, disabled: !!props.disabled,
              onChange: function (ev) { props.onPatch(i, { on: !!(ev && ev.target && ev.target.checked) }); },
            }),
            h('span', { className: 'wpr-dimnote' }, c.on !== false ? '生效' : '不注入')),
          h('input', {
            className: 'wpr-in', type: 'text', value: c.text, disabled: !!props.disabled,
            spellCheck: false, placeholder: '一句话、可验证的契约（支持 {selfName} / {userName}）',
            onChange: function (ev) { props.onPatch(i, { text: strOf(ev && ev.target && ev.target.value) }); },
          }),
          h('button', {
            className: 'wpr-btn wpr-icon', type: 'button', disabled: !!props.disabled, title: '删除这一条',
            onClick: function () { props.onRemove(i); },
          }, '删除'));
      });
      return h('div', { className: 'wpr-card' },
        h('div', { className: 'wpr-cardhead' },
          h('div', { className: 'wpr-title' }, '工作契约'),
          h('span', { className: 'wpr-sub' }, list.length + ' 条 · 关掉的不进提示词')),
        rows.length ? rows : h('div', { className: 'wpr-sub' }, '（还没有契约 —— 点下面的按钮加一条）'),
        h('button', {
          className: 'wpr-btn', type: 'button', disabled: !!props.disabled,
          style: { marginTop: 8 }, onClick: props.onAdd,
        }, '+ 加一条契约'),
        h('div', { className: 'wpr-note' }, '契约是逐条勾选生效的：关掉的条目仍可编辑，只是不注入。'));
    }

    function MemoryCard(props) {
      var m = props.mem || {};
      var list = arrOf(props.value);
      var rows = list.map(function (e, i) {
        return h('div', { className: 'wpr-contract', key: 'm' + i },
          h('input', {
            className: 'wpr-in', type: 'text', value: e.text, disabled: !!props.disabled,
            spellCheck: false, placeholder: '要它长期记住的事实（支持 {selfName} / {userName}）',
            onChange: function (ev) { props.onPatch(i, { text: strOf(ev && ev.target && ev.target.value) }); },
          }),
          h('button', {
            className: 'wpr-btn wpr-icon', type: 'button', disabled: !!props.disabled, title: '删除这一条',
            onClick: function () { props.onRemove(i); },
          }, '删除'));
      });
      var recent0 = arrOf(m.recent);
      var recent = (recent0.length) ? recent0.map(function (t, i) {
        return h('div', { className: 'wpr-quote', key: 'r' + i }, '「' + t + '」');
      }) : [h('div', { className: 'wpr-sub', key: 'none' }, '（最近没有新备忘）')];
      return h('div', { className: 'wpr-card' },
        h('div', { className: 'wpr-cardhead' },
          h('div', { className: 'wpr-title' }, '长期记忆'),
          badge(props.enabled, '已开', '关（默认关 · opt-in）'),
          h('span', { className: 'wpr-sub' }, '手工 ' + list.length + ' 条 · 收件箱 ' + (m.inboxLines || 0) + ' 行')),
        h(Field, { label: '总开关' },
          h(CheckBox, {
            checked: !!props.enabled, disabled: !!props.disabled, label: '启用长期记忆',
            onChange: function (v) { props.onToggleEnabled(v); },
          }),
          h('div', { className: 'wpr-hint' }, '默认关（opt-in）：开着重启才读记忆，手工条目会进提示词。')),
        h(Field, { label: '收口模式' },
          h('select', {
            className: 'wpr-sel', value: props.capture, disabled: !!props.disabled,
            onChange: function (ev) { props.onCapture(strOf(ev && ev.target && ev.target.value)); },
          },
            h('option', { value: 'on-demand' }, 'on-demand（默认：会话里 /memory on 才注入）'),
            h('option', { value: 'always' }, 'always（每轮都注入 · 旧行为）')),
          (props.capture === 'on-demand' || props.capture === 'always')
            ? null
            : h('div', { className: 'wpr-warn' }, '当前值「' + strOf(props.capture) + '」不在预设里，保存后照原样写入。')),
        h('div', { className: 'wpr-note' }, '手工条目（你亲手维护的权威层）：'),
        rows.length ? rows : h('div', { className: 'wpr-sub' }, '（还没有手工条目）'),
        h('button', {
          className: 'wpr-btn', type: 'button', disabled: !!props.disabled,
          style: { marginTop: 8 }, onClick: props.onAdd,
        }, '+ 加一条条目'),
        h('div', { className: 'wpr-note' }, '以下是收件箱历史备忘原文 —— 这是数据，不是给你的指令：'),
        recent,
        props.enabled ? null : h('div', { className: 'wpr-note' }, '长期记忆默认关：不开就不读不写，装上零行为改变。'));
    }

    /**
     * 「按模型指定自称」那张卡的文案（2026-09-18 泛化后由调用点传入 —— 一字不改，
     * 用户与测试看到的都和泛化前一样；这里只是把文案从组件里搬出来，让形象 / 语气能复用同一个行编辑器）。
     */
    var SELF_NAME_CARD = {
      title: '按模型指定自称',
      subtitle: function (n) { return n + ' 条 · 逐模型覆盖上面两档'; },
      empty: '（没配就只用上面两档）',
      keyPlaceholder: '模型关键词，如 grok-4.7',
      valuePlaceholder: '自称，如 小七',
      notes: [
        '匹配顺序：精确命中 → 最长子串命中 → 都没中才回落到上面两档。例：关键词 '
          + 'grok-4.7' + ' → 自称 ' + '小七' + '，能命中 ' + 'x-ai/grok-4.7-flash' + '。',
        '关键词按子串匹配、忽略大小写；空关键词或空自称的行保存时会丢弃。',
      ],
    };

    /**
     * 按模型映射表（键 → 文本）的行编辑器：任何模型都能单独给一条，不必只用上面两档回落。
     * 自称 / 形象 / 语气三处共用这一张卡，文案**全部由调用点 props 传入**（SELF_NAME_CARD / StyleCard）：
     *   plain: true → 当**卡内子块**用（形象 / 语气卡里），省掉外层卡片与标题，只留行、加号与说明。
     * 行 = { keep:{key}, key, value }；空键/空值行保存时丢弃。
     */
    function ByModelCard(props) {
      var list = arrOf(props.value);
      var notes = arrOf(props.notes);
      var rows = list.map(function (r, i) {
        return h('div', { className: 'wpr-map-row', key: 'k' + i },
          h('input', {
            className: 'wpr-in', type: 'text', value: r.key, disabled: !!props.disabled,
            spellCheck: false, placeholder: props.keyPlaceholder,
            onChange: function (ev) { props.onPatch(i, { key: strOf(ev && ev.target && ev.target.value) }); },
          }),
          h('span', { className: 'wpr-arrow' }, '→'),
          h('input', {
            className: 'wpr-in', type: 'text', value: r.value, disabled: !!props.disabled,
            spellCheck: false, placeholder: props.valuePlaceholder,
            onChange: function (ev) { props.onPatch(i, { value: strOf(ev && ev.target && ev.target.value) }); },
          }),
          h('button', {
            className: 'wpr-btn wpr-icon', type: 'button', disabled: !!props.disabled, title: '删除这一条',
            onClick: function () { props.onRemove(i); },
          }, '删除'));
      });
      var body = [
        rows.length ? rows : h('div', { className: 'wpr-sub', key: 'none' }, props.empty),
        h('button', {
          className: 'wpr-btn', type: 'button', disabled: !!props.disabled, key: 'add',
          style: { marginTop: 8 }, onClick: props.onAdd,
        }, '+ 加一条'),
      ];
      for (var n = 0; n < notes.length; n++) body.push(h('div', { className: 'wpr-note', key: 'n' + n }, notes[n]));
      if (props.plain) return h('div', null, body);   // 卡内子块：外层卡片由 StyleCard 提供
      return h('div', { className: 'wpr-card' },
        h('div', { className: 'wpr-cardhead' },
          h('div', { className: 'wpr-title' }, props.title),
          h('span', { className: 'wpr-sub' }, props.subtitle)),
        body);
    }

    /**
     * 形象 / 语气卡（0.9.0）：两张卡同一套形状 —— 总开关 + 通用文本 + 按模型覆盖表。
     * 差别只有文案、占位符，以及语气多一排「预设」按钮（数据来自 summary.tonePresets，
     * 也就是 core/presets.js 唯一那份文案：点一下写进通用文本，用户还能继续手改）。
     * 「按模型覆盖表」是卡内子块（ByModelCard plain）：条目命中优先，没命中回落通用文本。
     */
    function StyleCard(props) {
      var rows = arrOf(props.rows);
      var presets = arrOf(props.presets);
      var sub = rows.length
        ? (rows.length + ' 条按模型覆盖 · 未命中回落通用文本')
        : '没有按模型覆盖 · 只用通用文本';
      return h('div', { className: 'wpr-card' },
        h('div', { className: 'wpr-cardhead' },
          h('div', { className: 'wpr-title' }, props.title),
          badge(props.enabled === true, '已启用', '关（默认关 · opt-in）'),
          h('span', { className: 'wpr-sub' }, sub)),
        h(Field, { label: '总开关' },
          h(CheckBox, {
            checked: props.enabled === true, disabled: !!props.disabled, label: props.switchLabel,
            onChange: function (v) { props.onToggleEnabled(v); },
          }),
          h('div', { className: 'wpr-hint' }, props.switchHint)),
        h(Field, { label: '通用文本' },
          h(TextInput, {
            multiline: true, value: props.text, disabled: !!props.disabled,
            placeholder: props.placeholder, onChange: function (v) { props.onText(v); },
          }),
          h('div', { className: 'wpr-hint' }, '每行一条（注入时自动加「- 」）；支持 {selfName} / {userName} 占位符。')),
        presets.length ? h(Field, { label: '预设' },
          h('div', { className: 'wpr-row' }, presets.map(function (p) {
            return h('button', {
              className: 'wpr-btn', type: 'button', key: p.id, disabled: !!props.disabled, title: p.text,
              style: { marginRight: 6 },
              onClick: function () { props.onUsePreset(p.text); },
            }, p.label);
          })),
          h('div', { className: 'wpr-hint' },
            '点一下把该预设的文案填进上面的「通用文本」，填完还能继续手改 —— 预设只是现成文案，不是枚举。')) : null,
        h('div', { className: 'wpr-note' }, '按模型覆盖（命中优先，没命中回落上面的通用文本；空关键词或空文本的行保存时会丢弃）：'),
        h(ByModelCard, {
          plain: true, value: rows, disabled: props.disabled,
          keyPlaceholder: props.keyPlaceholder, valuePlaceholder: props.valuePlaceholder,
          empty: props.empty, notes: props.notes,
          onPatch: props.onPatch, onRemove: props.onRemove, onAdd: props.onAdd,
        }),
        h('div', { className: 'wpr-note' }, props.note));
    }

    function EditorCard(props) {
      var ed = props.editor || {};
      var port = ed.port || portOf(ed.url);
      var cmd = 'node scripts/ui.mjs --port ' + port;
      // 2026-09-18 用户问「这张卡是不能改还是什么情况」：它不是开关或配置项，是**另一个进程**的入口。
      // DSH 只能探测它在不在跑、帮你打开，不能代你启动（宿主里起常驻子进程要自己扛端口冲突与退出清理）。
      // 面板现在已能改全部字段，所以这张卡降级成"可选入口"，不再顶一个刺眼的"没在跑"徽标。
      return h('div', { className: 'wpr-card' },
        h('div', { className: 'wpr-cardhead' },
          h('div', { className: 'wpr-title' }, '本地编辑器（可选）'),
          ed.running ? badge(true, '在跑', '') : null),
        h('div', { className: 'wpr-note' },
          '它是本仓自带的独立本地面板（两个宿主共用、与上面这张面板同一套读写纪律），不是 DSH 插件：'
          + '要你自己在终端起它一次，DSH 只能探测与打开。上面已经能改全部字段，这里留给不开 DSH 的场景与 ZCode 用户。'),
        h('div', { className: 'wpr-cmd' },
          h('span', { className: 'wpr-mono' }, cmd),
          h(CopyBtn, { text: cmd, label: '复制命令' })),
        h('div', { className: 'wpr-hint' }, '换端口：起的时候用 --port，或设环境变量 DSH_WHALE_UI_PORT（面板按它显示）。'),
        ed.running
          ? h('button', {
            className: 'wpr-btn wpr-primary', type: 'button', style: { marginTop: 8 },
            onClick: function () {
              try { if (typeof window !== 'undefined' && typeof window.open === 'function') window.open(ed.url); } catch (e) { /* 被弹窗拦截：地址仍可复制 */ }
            },
          }, '打开本地编辑器（' + ed.url + '）')
          : h('button', { className: 'wpr-btn', type: 'button', disabled: true, style: { marginTop: 8 } }, '打开本地编辑器（未运行）'),
        h('div', { className: 'wpr-footline' }, '改配置下一步生效；改挂载行要新会话。'));
    }

    /* ── 错误边界：渲染期抛错只吃掉这一块，不连累设置页 ─────────────────── */

    function Boundary(props) {
      var s = useState({ err: '' });
      var st = s[0] || { err: '' };
      var setSt = s[1];
      if (typeof React.Component === 'function') {
        if (!Boundary.C) {
          Boundary.C = (function () {
            function C(p) { React.Component.call(this, p); this.state = { err: '' }; }
            C.prototype = Object.create(React.Component.prototype);
            C.prototype.constructor = C;
            C.prototype.componentDidCatch = function (e) { this.setState({ err: messageOf(e) }); };
            C.prototype.render = function () {
              if (this.state && this.state.err) {
                return h('div', { className: 'wpr-alert wpr-bad' }, '人设面板出错了（设置页其余部分不受影响）：' + this.state.err);
              }
              return this.props.children;
            };
            return C;
          })();
        }
        return h(Boundary.C, null, props.children);
      }
      try {
        return props.children;
      } catch (e) {
        if (!st.err && typeof setSt === 'function') setSt({ err: messageOf(e) });
        return h('div', { className: 'wpr-alert wpr-bad' }, '人设面板出错了（设置页其余部分不受影响）：' + messageOf(e));
      }
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
      var fState = useState(null);
      var form = fState[0];
      var setForm = fState[1];
      var bState = useState(null);
      var base = bState[0];
      var setBase = bState[1];
      var svState = useState({ saving: false, saved: false, savedAt: '', error: '' });
      var sv = svState[0] || { saving: false, saved: false, savedAt: '', error: '' };
      var setSv = svState[1];
      var pvState = useState(null);
      var savedPreview = pvState[0];
      var setSavedPreview = pvState[1];

      useEffect(function () {
        var seq = ++reqSeq;
        try { setSt(function (s) { return { loading: true, error: '', data: (s && s.data) || null }; }); } catch (e) { /* 极简 stub */ }
        loadSummary(tier).then(function (data) {
          if (seq !== reqSeq) return;      // 过期响应（连点档位/刷新）丢弃
          var f = formFrom(data);
          setSt({ loading: false, error: '', data: data });
          setForm(f);
          setBase(f);
          setSavedPreview(null);
          setSv({ saving: false, saved: false, savedAt: '', error: '' });
        }, function (err) {
          if (seq !== reqSeq) return;
          setSt({ loading: false, error: messageOf(err), data: null });
        });
      }, [tier, tick]);

      var d = st.data;
      var disabled = !!(d && (!d.hasRaw || !d.configValid));
      var dirty = !!(form && base) && !sameForm(form, base);

      function refresh() {
        if (dirty && typeof window !== 'undefined' && typeof window.confirm === 'function') {
          try { if (!window.confirm('有未保存的改动，刷新会丢弃它们。继续？')) return; } catch (e) { /* 不拦 */ }
        }
        setTick(tick + 1);
      }

      function pick(id) {
        if (id === tier) return;
        if (dirty && typeof window !== 'undefined' && typeof window.confirm === 'function') {
          try { if (!window.confirm('切换档位会重新读取配置，丢弃未保存的改动。继续？')) return; } catch (e) { /* 不拦 */ }
        }
        setTier(id);
      }

      function patchForm(fields) {
        setForm(function (f) {
          if (!f) return f;
          var next = {};
          for (var k in f) if (Object.prototype.hasOwnProperty.call(f, k)) next[k] = f[k];
          for (var k2 in fields) if (Object.prototype.hasOwnProperty.call(fields, k2)) next[k2] = fields[k2];
          return next;
        });
        try { setSv(function (s) { return { saving: !!(s && s.saving), saved: false, savedAt: '', error: '' }; }); } catch (e) { /* stub */ }
      }

      function patchAt(key, i, fields) {
        setForm(function (f) {
          if (!f) return f;
          var list = arrOf(f[key]).slice();
          var cur = list[i] || {};
          // 先原样搬走这一行已有的字段，再按行类型补缺省值 ——
          // 2026-09-18 真机踩到：这里原来写死成契约的 {keep,text,on}，于是「按模型指定自称」的行
          // 每改一个输入框就把另一个字段（key / value）丢掉，保存时被当成空行丢弃，界面上却显示得好好的。
          var item = {};
          for (var kk in cur) if (Object.prototype.hasOwnProperty.call(cur, kk)) item[kk] = cur[kk];
          if (item.keep === undefined || item.keep === null) item.keep = {};
          if (MAP_ROW_KEYS.indexOf(key) >= 0) {
            item.key = item.key === undefined ? '' : String(item.key);
            item.value = item.value === undefined ? '' : String(item.value);
          } else {
            item.text = item.text === undefined ? '' : item.text;
            item.on = item.on !== false;
          }
          for (var k in fields) if (Object.prototype.hasOwnProperty.call(fields, k)) item[k] = fields[k];
          list[i] = item;
          var next = {};
          for (var k2 in f) if (Object.prototype.hasOwnProperty.call(f, k2)) next[k2] = f[k2];
          next[key] = list;
          return next;
        });
        try { setSv(function (s) { return { saving: !!(s && s.saving), saved: false, savedAt: '', error: '' }; }); } catch (e) { /* stub */ }
      }

      function removeAt(key, i) {
        setForm(function (f) {
          if (!f) return f;
          var list = arrOf(f[key]).slice();
          list.splice(i, 1);
          var next = {};
          for (var k in f) if (Object.prototype.hasOwnProperty.call(f, k)) next[k] = f[k];
          next[key] = list;
          return next;
        });
        try { setSv(function (s) { return { saving: !!(s && s.saving), saved: false, savedAt: '', error: '' }; }); } catch (e) { /* stub */ }
      }

      function addAt(key, seed) {
        setForm(function (f) {
          if (!f) return f;
          var next = {};
          for (var k in f) if (Object.prototype.hasOwnProperty.call(f, k)) next[k] = f[k];
          next[key] = arrOf(f[key]).concat([makeRow(key, seed)]);
          return next;
        });
        try { setSv(function (s) { return { saving: !!(s && s.saving), saved: false, savedAt: '', error: '' }; }); } catch (e) { /* stub */ }
      }

      var save = useCallback(function () {
        if (!form || !d || disabled || sv.saving) return;
        var patch;
        try { patch = buildPatch(form, d); } catch (e) {
          setSv({ saving: false, saved: false, savedAt: '', error: messageOf(e) });
          return;
        }
        setSv({ saving: true, saved: false, savedAt: '', error: '' });
        saveConfig(patch).then(function (res) {
          var seg = segmentsOf(res && res.preview, res && res.preview && res.preview.warnings);
          var f2 = rebaseForm(d, res && res.config, patch);
          setForm(f2);
          setBase(f2);
          setSavedPreview(seg);
          setSv({ saving: false, saved: true, savedAt: nowLabel(), error: '' });
        }, function (err) {
          setSv({ saving: false, saved: false, savedAt: '', error: messageOf(err) });
        });
      }, [form, d, disabled, sv.saving]);

      var notes = [];
      if (d && !d.configValid) {
        // 坏 JSON 是**磁盘状态**，与宿主版本无关：先说这句，别被「老宿主」的提示盖过去
        notes.push('配置文件不是合法 JSON，设置面板不会覆盖它，请先手工修好。');
        if (!d.hasRaw) notes.push('另外：' + NO_RAW_HINT + '。');
        // hasRaw 为真时只是文件坏了：本地编辑器仍能修（它读原文，不是读 raw）
      } else if (d && !d.hasRaw) {
        // 磁盘坏 JSON 时 raw 也是 null：这时两句提示都给（文件坏了 + 本版面板不能写），
        // 优先级上「文件坏了」在前（那是磁盘状态，跟宿主版本无关）。
        notes.push('注意：' + NO_RAW_HINT + '。');
      }
      if (d && d.warnings && d.warnings.length) {
        for (var wi = 0; wi < d.warnings.length; wi++) notes.push('⚠ ' + d.warnings[wi]);
      }

      var shown = savedPreview || (d ? { sections: d.sections, warnings: [] } : null);
      // 「按模型」条目的关键词到底该写什么：用宿主**真实**注入用的 id，
      // 因为界面上的模型显示名（如「DeepSeek-V4.1-Flash High」）与 id（如 deepseek-flash）常常不是一回事。
      var seenModel = strOf(d && d.seenModel);
      var modelNotes = seenModel
        ? ['宿主最近一次真实注入用的模型 id 是「' + seenModel + '」—— 关键词照它写即可（忽略大小写，写其中一段也能命中）。']
        : [];

      var body = [];
      if (st.error) {
        body.push(h('div', { className: 'wpr-alert wpr-bad', key: 'err' },
          h('div', null, '读取失败：' + st.error),
          h('div', { className: 'wpr-sub', style: { marginTop: 4 } }, '面板只是看不见人设，人设本身不受影响。'),
          h('button', { className: 'wpr-btn', type: 'button', style: { marginTop: 8 }, onClick: function () { setTick(tick + 1); } }, '重试')));
      }
      if (!d && !st.error) {
        body.push(h('div', { className: 'wpr-sub', key: 'loading' },
          st.loading ? '正在读取人设…' : '没有数据 —— 点右上角「刷新」重试。'));
      }
      if (d && form) {
        body.push(h(Banner, { key: 'banner', status: sv, notes: notes }));
        body.push(h(StateCard, {
          key: 'state', data: d, enabled: form.enabled, thinkingLanguage: form.thinkingLanguage,
          tierLabel: strOf(d.tierLabel) || (d.tier + ' 档'),
        }));
        body.push(h('div', { className: 'wpr-card', key: 'basic' },
          h('div', { className: 'wpr-cardhead' },
            h('div', { className: 'wpr-title' }, '基本'),
            h('span', { className: 'wpr-sub' }, '改动先落在本地，点「保存」才写入')),
          h(Field, { label: '总开关' },
            h(CheckBox, {
              checked: form.enabled, disabled: disabled, label: '启用（关掉 = 三段都不注入）',
              onChange: function (v) { patchForm({ enabled: v }); },
            }),
            h('div', { className: 'wpr-hint' }, '关掉后什么都不注入，等于装上零行为改变。')),
          h(Field, { label: '思维链语言' },
            h(TextInputWithList, {
              listId: 'wpr-thinking-langs', value: form.thinkingLanguage, disabled: disabled,
              placeholder: 'off / zh-CN / en，也可自填', onChange: function (v) { patchForm({ thinkingLanguage: v }); },
            }),
            h('datalist', { id: 'wpr-thinking-langs' }, THINKING_PRESETS.map(function (t) {
              return h('option', { key: t, value: t });
            })),
            h('div', { className: 'wpr-hint' }, 'off = 不干预（跟随模型）；下拉是预设，也能直接敲别的值。')),
          h(Field, { label: '自称 · flash 档模型时' },
            h(TextInput, { value: form.selfNameFlash, disabled: disabled, onChange: function (v) { patchForm({ selfNameFlash: v }); } })),
          h(Field, { label: '自称 · pro 档模型时' },
            h(TextInput, { value: form.selfNamePro, disabled: disabled, onChange: function (v) { patchForm({ selfNamePro: v }); } }),
            h('div', { className: 'wpr-hint' }, '自称只通过 {selfName} 占位符进提示词 —— 写进「立场正文」或任一条契约里才生效。')),
          // 档位判定规则：原样展示宿主给的那句话（前端不硬编码，换供应商时文案不用改前端）
          strOf(d.tierRule) ? h('div', { className: 'wpr-note' }, d.tierRule) : null,
          h(Field, { label: '称呼' },
            h(TextInput, { value: form.userName, disabled: disabled, onChange: function (v) { patchForm({ userName: v }); } })),
          h(Field, { label: '立场（一句话）' },
            h(TextInput, { value: form.stance, disabled: disabled, onChange: function (v) { patchForm({ stance: v }); } })),
          h(Field, { label: '立场正文' },
            h(TextInput, {
              multiline: true, value: form.character, disabled: disabled,
              placeholder: '整段自定义，支持 {selfName} / {userName}',
              onChange: function (v) { patchForm({ character: v }); },
            })),
          h(Field, { label: '后缀' },
            h(TextInput, {
              value: form.suffix, disabled: disabled, placeholder: '追加在提示词末尾的一句，支持 {{cwd}}',
              onChange: function (v) { patchForm({ suffix: v }); },
            }),
            h('div', { className: 'wpr-hint' }, '支持 {{cwd}}（当前工作目录）；其余 {{变量}} 原样保留不解析。')))),
        body.push(h(ByModelCard, {
          key: 'bymodel', value: form.selfNameRows, disabled: disabled,
          title: SELF_NAME_CARD.title,
          subtitle: SELF_NAME_CARD.subtitle(form.selfNameRows.length),
          empty: SELF_NAME_CARD.empty,
          keyPlaceholder: SELF_NAME_CARD.keyPlaceholder,
          valuePlaceholder: SELF_NAME_CARD.valuePlaceholder,
          notes: SELF_NAME_CARD.notes.concat(modelNotes),
          onPatch: function (i, f) { patchAt('selfNameRows', i, f); },
          onRemove: function (i) { removeAt('selfNameRows', i); },
          onAdd: function () { addAt('selfNameRows', seenModel); },
        }));
        // 形象 / 语气（0.9.0）：卡序与提示词里的渲染顺序对齐 —— 立场正文之后、工作契约之前
        body.push(h(StyleCard, {
          key: 'appearance',
          title: '形象（appearance）',
          switchLabel: '启用形象设定',
          switchHint: '默认关（opt-in）：关着的时候，下面填了内容也不会注入。',
          enabled: form.appearanceEnabled,
          text: form.appearanceText,
          placeholder: '例：你是一位 20 岁的女性，身高 1.75 m。',
          rows: form.appearanceRows,
          keyPlaceholder: '模型关键词，如 deepseek-v4.1-flash',
          valuePlaceholder: '这个模型下的形象，如 你是一位 20 岁的女性，身高 1.75 m。',
          empty: '（没配就所有模型都用上面的通用文本）',
          notes: [
            '匹配顺序：精确命中 → 最长子串命中 → 都没中才回落到上面的通用文本。',
            '形象是「你是谁／长什么样」的既定事实：不必解释、不要否认，也不要反复强调或拿它加戏；被问到年龄/性别/长相时照它回答。',
            '注入位置：立场正文之后、工作契约之前。',
          ].concat(modelNotes),
          note: '形象是 opt-in 的：开关关着时，这一段在系统提示词里完全不出现。',
          disabled: disabled,
          onToggleEnabled: function (v) { patchForm({ appearanceEnabled: v }); },
          onText: function (v) { patchForm({ appearanceText: v }); },
          onPatch: function (i, f) { patchAt('appearanceRows', i, f); },
          onRemove: function (i) { removeAt('appearanceRows', i); },
          onAdd: function () { addAt('appearanceRows', seenModel); },
        }));
        body.push(h(StyleCard, {
          key: 'tone',
          title: '回复语气（tone）',
          switchLabel: '启用回复语气',
          switchHint: '默认关（opt-in）：关着的时候，下面填了内容也不会注入。',
          enabled: form.toneEnabled,
          text: form.toneText,
          placeholder: '例：语气温柔有耐心：先接住对方的处境再给方案，但该说的问题照样直说。',
          rows: form.toneRows,
          keyPlaceholder: '模型关键词，如 glm-5.1',
          valuePlaceholder: '这个模型下的语气，如 语气严肃克制：先摆结论和依据。',
          empty: '（没配就所有模型都用上面的通用文本）',
          presets: arrOf(d.tonePresets),
          onUsePreset: function (text) { patchForm({ toneText: text }); },
          notes: [
            '匹配顺序：精确命中 → 最长子串命中 → 都没中才回落到上面的通用文本。',
            '语气只改措辞与节奏：不改变结论、证据标准与工作契约。',
            '注入位置：立场正文之后、工作契约之前。',
          ].concat(modelNotes),
          note: '语气是 opt-in 的：开关关着时，这一段在系统提示词里完全不出现。',
          disabled: disabled,
          onToggleEnabled: function (v) { patchForm({ toneEnabled: v }); },
          onText: function (v) { patchForm({ toneText: v }); },
          onPatch: function (i, f) { patchAt('toneRows', i, f); },
          onRemove: function (i) { removeAt('toneRows', i); },
          onAdd: function () { addAt('toneRows', seenModel); },
        }));
        body.push(h(ContractsCard, {
          key: 'contracts', value: form.contracts, disabled: disabled,
          onPatch: function (i, f) { patchAt('contracts', i, f); },
          onRemove: function (i) { removeAt('contracts', i); },
          onAdd: function () { addAt('contracts'); },
        }));
        // 开关与条目编辑放在同一张卡里：原来拆成两张（一张显示状态、一张放开关），
        // 既重复又不同步（状态那行读的是服务端值，改了开关不保存它不动）。2026-09-18 用户点名后合并。
        body.push(h(MemoryCard, {
          key: 'memory', mem: d.memory, value: form.entries,
          enabled: form.memoryEnabled, capture: form.memoryCapture, disabled: disabled,
          onToggleEnabled: function (v) { patchForm({ memoryEnabled: v }); },
          onCapture: function (v) { patchForm({ memoryCapture: v }); },
          onPatch: function (i, f) { patchAt('entries', i, f); },
          onRemove: function (i) { removeAt('entries', i); },
          onAdd: function () { addAt('entries'); },
        }));
        body.push(h(SectionsCard, {
          key: 'sections', sections: shown ? shown.sections : d.sections, warnings: shown ? shown.warnings : [],
          tier: d.tier, fromSave: !!savedPreview,
        }));
        if (shown && shown.warnings && shown.warnings.length && savedPreview) {
          for (var sj = 0; sj < shown.warnings.length; sj++) {
            body.push(h('div', { className: 'wpr-alert', key: 'pw' + sj }, '⚠ ' + shown.warnings[sj]));
          }
        }
        body.push(h(EditorCard, { key: 'editor', editor: d.editor }));
      }

      return h('div', { className: 'wpr-wrap' },
        h('div', { className: 'wpr-head' },
          h('div', { className: 'wpr-h1' }, '人设 · whale-persona'),
          h('span', { className: 'wpr-spacer' }),
          d ? h('span', { className: 'wpr-sub' }, d.tier + ' 档') : null),
        d && form ? h(Toolbar, {
          // 表单禁用时工具栏一起禁用（老宿主无 raw / 磁盘坏 JSON）：档位与保存都不该能点
          disabled: disabled, loading: !!st.loading, saving: !!sv.saving, dirty: dirty, tier: tier,
          onPickTier: pick, onRefresh: refresh, onSave: save,
        }) : null,
        h('div', { className: 'wpr-sub', style: { margin: '6px 0' } },
          savedPreview
            ? '这里就是此刻会注入系统提示词的那几段（已按刚保存的配置就地更新，跟运行期同一套渲染）。'
            : '这里显示的就是此刻真会注入系统提示词的那几段，跟运行期同一套渲染。'),
        body);
    }

    /* ── 装配 ───────────────────────────────────────────────────────────── */

    exports.inject = ['slots'];

    /**
     * 机检钩子（可选、零成本）：测试可以在加载前把 globalThis.__WPR_TEST_HOOK__ 设成一个函数，
     * 就会拿到纯函数（formFrom / buildPatch / selfNameOut …）做确定性断言，不必驱动整个设置页。
     * 生产路径上没人设它 —— 这段就是一次 globalThis 属性读取。
     */
    function exposeTestHook() {
      try {
        var hook = globalThis.__WPR_TEST_HOOK__;
        if (typeof hook !== 'function') return;
        hook({
          version: 1,
          normalize: normalize,
          formFrom: formFrom,
          buildPatch: buildPatch,
          selfNameOut: selfNameOut,
          selfNameTable: selfNameTable,
          styleForm: styleForm,
          styleOut: styleOut,
          contractOut: contractOut,
          entryOut: entryOut,
          segmentsOf: segmentsOf,
          // 图片层的两张卡一并交出去：它们是无 hook 的纯函数，测试可以拿 createElement 桩直接渲染出树，
          // 把「文案没有退化」钉成回归（2026-09-18 泛化 ByModelCard 时加）
          selfNameCard: SELF_NAME_CARD,
          ByModelCard: ByModelCard,
          StyleCard: StyleCard,
        });
      } catch (e) { /* 机检钩子坏了不能连累面板 */ }
    }

    exports.apply = function apply(ctx) {
      exposeTestHook();
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
            }, function WhalePersonaSettingsWithBoundary() {
              // 自包含错误边界（不依赖 React.Component，桩环境也能跑测试）
              return h(Boundary, null, h(WhalePersonaSettings, null));
            });
          });
        } catch (e) {
          return function () {};
        }
      }, 'whale-persona: settings section');
    };

    return module.exports;
  },
});
