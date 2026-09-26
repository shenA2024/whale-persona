/**
 * whale-persona-ui —— 设置面板（浏览器半身 · 可编辑版）
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
  id: 'whale-persona-ui',
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require('react');
    var h = React.createElement;

    var SUMMARY_API = '/whale-persona/api/summary';
    var CONFIG_API = '/whale-persona/api/config';
    var PRESETS_API = '/whale-persona/api/presets';
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
    /* ══════════════════════════════════════════════════════════════════════
     * 样式：**只有一层**（2026-09-19 收口：按用户要求只留一层，不留任何自带外观开关）。
     * 全部选择器落在 .wpr-* 作用域内，颜色只用宿主变量 var(--dsw-alias-*, 兜底值)。
     * 硬纪律：**不覆盖任何颜色**、不碰 :root / html / body、不覆盖 --dsw-* 宿主变量、
     * 没有裸元素选择器、没有 !important —— 装上它 + 任何第三方美化插件 = 互不干扰。
     * 宿主 token 名取自 DSH 前端产物实测（dsh-client-ui-theme 的 body[data-ds-dark-theme] 一段）：
     *   --dsw-alias-label-primary / -secondary / -tertiary / -dimmed
     *   --dsw-alias-border-l1..l4、--dsw-alias-bg-base / bg-layer-1 / bg-layer-2
     *   --dsw-alias-brand-primary、-button-primary-fill / -hover、-interactive-bg-hover
     *   --dsw-alias-state-success-primary / -tertiary、-warn-label / -tertiary、-error-primary …
     * ══════════════════════════════════════════════════════════════════════ */
    var BASE_TAG = 'dsh-whale-persona-ui';

    var CSS = [
      // 作用域内自己的变量（不是宿主变量、也不改宿主变量）：圆角/密度/颜色都从这里取
      '.wpr-wrap{--wpr-r:12px;--wpr-r-ctl:8px;--wpr-h:30px;--wpr-gap:12px;',
      '--wpr-line:var(--dsw-alias-border-l2,rgba(127,127,127,.28));',
      '--wpr-line-soft:var(--dsw-alias-border-l1,rgba(127,127,127,.18));',
      '--wpr-card-bg:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.06));',
      '--wpr-inset-bg:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.03));',
      '--wpr-t1:var(--dsw-alias-label-primary,#e6e6e6);',
      '--wpr-t2:var(--dsw-alias-label-secondary,#9aa0a6);',
      '--wpr-t3:var(--dsw-alias-label-tertiary,#8b9198);',
      '--wpr-accent:var(--dsw-alias-brand-primary,#4c8dff);',
      // 主按钮的**前景色**：宿主在深色下 brand-primary 是浅色（#f9fafb），不取 label-primary-foreground 就会变成白底白字（本机实测过）
      '--wpr-accent-ink:var(--dsw-alias-label-primary-foreground,#0b0b0d);',
      '--wpr-accent-fill:var(--dsw-alias-button-primary-fill,rgba(76,141,255,.16));',
      '--wpr-accent-hover:var(--dsw-alias-button-primary-hover,rgba(76,141,255,.26));',
      '--wpr-hover:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.10));',
      '--wpr-ok:var(--dsw-alias-state-success-primary,#3fb950);',
      '--wpr-ok-bg:var(--dsw-alias-state-success-tertiary,rgba(63,185,80,.12));',
      '--wpr-warn:var(--dsw-alias-state-warn-label,#e5a03c);',
      '--wpr-warn-bg:var(--dsw-alias-state-warn-tertiary,rgba(229,160,75,.12));',
      '--wpr-err:var(--dsw-alias-state-error-primary,#e5534b);',
      '--wpr-err-bg:var(--dsw-alias-state-error-tertiary,rgba(229,83,75,.12));',
      'padding:16px 20px 40px;max-width:820px;color:var(--wpr-t1);font-size:13px;line-height:1.6;',
      'font-family:var(--dsw-font-family,"Segoe UI","Microsoft YaHei",system-ui,sans-serif)}',
      // 页头 / 工具栏
      '.wpr-head{display:flex;align-items:center;gap:8px}',
      '.wpr-h1{font-size:14px;font-weight:600;margin:0}',
      '.wpr-spacer{margin-left:auto}',
      '.wpr-sub{color:var(--wpr-t2);font-size:11.5px}',
      '.wpr-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;position:sticky;top:0;z-index:2;',
      'padding:8px 0;background:var(--dsw-alias-bg-base,#141416);border-bottom:1px solid var(--wpr-line-soft)}',
      '.wpr-tier{display:inline-flex;border:1px solid var(--wpr-line);border-radius:var(--wpr-r-ctl);overflow:hidden;background:var(--wpr-inset-bg)}',
      '.wpr-tier button{background:transparent;border:0;color:inherit;font:inherit;font-size:12px;height:26px;padding:0 12px;cursor:pointer}',
      '.wpr-tier button.wpr-active{background:var(--wpr-hover);color:var(--wpr-t1)}',
      // 分组标题：轻量一行；组间距（20px）> 组内卡片间距（8px），层级靠间距不靠色块
      '.wpr-group{display:flex;align-items:baseline;gap:8px;margin:20px 0 4px;font-size:12px;font-weight:600;color:var(--wpr-t1)}',
      '.wpr-group:first-child{margin-top:4px}',
      '.wpr-group .wpr-sub{font-weight:400}',
      // 卡片：1px 边框、无阴影、圆角统一
      '.wpr-card{border:1px solid var(--wpr-line);border-radius:var(--wpr-r);background:var(--wpr-card-bg);padding:12px 14px;margin:8px 0}',
      '.wpr-card-lite{padding:8px 14px}',
      '.wpr-cardhead{display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap}',
      '.wpr-title{font-weight:600;font-size:12px}',
      // 设置项：label 列（固定宽、右对齐）+ 控件列；控件高度统一 --wpr-h
      '.wpr-field{display:flex;gap:10px;align-items:flex-start;margin:6px 0}',
      '.wpr-flabel{flex:0 0 112px;text-align:right;color:var(--wpr-t2);font-size:12px;line-height:var(--wpr-h);min-height:var(--wpr-h)}',
      '.wpr-fbody{flex:1 1 auto;min-width:0}',
      '.wpr-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-height:var(--wpr-h)}',
      '.wpr-row-tight{min-height:0;margin:2px 0}',
      '.wpr-in,.wpr-sel{width:100%;box-sizing:border-box;height:var(--wpr-h);background:var(--wpr-inset-bg);color:inherit;',
      'font:inherit;font-size:12px;border:1px solid var(--wpr-line);border-radius:var(--wpr-r-ctl);padding:0 8px;outline:none}',
      '.wpr-sel{width:auto;max-width:100%}',
      '.wpr-in:focus,.wpr-ta:focus,.wpr-sel:focus{border-color:var(--wpr-accent)}',
      '.wpr-ta{width:100%;box-sizing:border-box;min-height:76px;resize:vertical;font-size:12px;line-height:1.6;',
      'background:var(--wpr-inset-bg);color:inherit;border:1px solid var(--wpr-line);border-radius:var(--wpr-r-ctl);padding:6px 8px;outline:none;',
      'font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}',
      '.wpr-in:disabled,.wpr-ta:disabled,.wpr-sel:disabled{opacity:.5;cursor:not-allowed}',
      '.wpr-btn{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;height:var(--wpr-h);',
      'background:transparent;border:1px solid var(--wpr-line);color:inherit;border-radius:var(--wpr-r-ctl);',
      'padding:0 12px;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}',
      '.wpr-btn:hover:not([disabled]){background:var(--wpr-hover)}',
      '.wpr-btn[disabled]{opacity:.45;cursor:default}',
      '.wpr-btn.wpr-primary{border-color:var(--wpr-accent);background:var(--wpr-accent-fill);color:var(--wpr-accent-ink)}',
      '.wpr-btn.wpr-primary:hover:not([disabled]){background:var(--wpr-accent-hover)}',
      '.wpr-btn.wpr-dirty{border-color:var(--wpr-accent);font-weight:600}',
      '.wpr-btn.wpr-icon{padding:0 8px}',
      '.wpr-btn.wpr-danger{color:var(--wpr-err)}',
      '.wpr-chk{display:inline-flex;align-items:center;gap:6px;cursor:pointer;user-select:none;font-size:12px}',
      '.wpr-chk input{width:14px;height:14px;margin:0;accent-color:var(--wpr-accent)}',
      '.wpr-hint{color:var(--wpr-t3);font-size:11px;margin:2px 0 0}',
      '.wpr-note{color:var(--wpr-t3);font-size:11px;margin:4px 0 0}',
      '.wpr-warn{color:var(--wpr-warn);font-size:12px}',
      '.wpr-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;word-break:break-all;user-select:text;-webkit-user-select:text}',
      '.wpr-dimnote{color:var(--wpr-t3);font-size:11px;white-space:nowrap}',
      '.wpr-mt8{margin-top:8px}',
      '.wpr-mt6{margin-top:6px}',
      '.wpr-mt4{margin-top:4px}',
      // 徽标 / 提示条 / 状态条
      '.wpr-badge{display:inline-block;border:1px solid var(--wpr-line);border-radius:999px;padding:0 8px;font-size:11px;line-height:18px;',
      'color:var(--wpr-t2);white-space:nowrap}',
      '.wpr-badge.wpr-on{color:var(--wpr-ok);border-color:var(--wpr-ok);background:var(--wpr-ok-bg)}',
      '.wpr-badge.wpr-off{color:var(--wpr-warn);border-color:var(--wpr-warn);background:var(--wpr-warn-bg)}',
      '.wpr-status{padding:10px 14px}',
      '.wpr-statusline{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-height:var(--wpr-h)}',
      '.wpr-dot{color:var(--wpr-err);font-size:11px}',
      '.wpr-dot.wpr-dot-on{color:var(--wpr-ok)}',
      '.wpr-sep{color:var(--wpr-t3)}',
      '.wpr-inline{width:132px;flex:0 0 auto}',
      '.wpr-alert{border:1px solid var(--wpr-warn);background:var(--wpr-warn-bg);color:var(--wpr-warn);border-radius:var(--wpr-r-ctl);',
      'padding:6px 10px;margin:8px 0;font-size:12px}',
      '.wpr-alert.wpr-bad{border-color:var(--wpr-err);background:var(--wpr-err-bg);color:var(--wpr-err)}',
      '.wpr-alert.wpr-ok{border-color:var(--wpr-ok);background:var(--wpr-ok-bg);color:var(--wpr-ok)}',
      '.wpr-alert .wpr-sub{color:inherit;opacity:.85}',
      // 折叠块（说明 / 按模型 / 本地编辑器一律走它，默认收起）
      '.wpr-disc{margin:6px 0 0}',
      '.wpr-discsum{display:flex;align-items:center;gap:6px;cursor:pointer;color:var(--wpr-t3);font-size:12px;list-style:none;padding:2px 0}',
      '.wpr-discsum:hover{color:var(--wpr-t1)}',
      // 2026-09-19 修复：summary 是 flex 容器，开关与标题默认 flex-shrink:1，被挤窄后中文逐字折行
      '.wpr-discsum>.wpr-chk{flex:0 0 auto;white-space:nowrap}',
      '.wpr-discsum>.wpr-title{flex:0 0 auto;white-space:nowrap}',
      '.wpr-discsum>.wpr-sub{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.wpr-discsum::before{content:"▸";font-size:10px;opacity:.8}',
      '.wpr-disc[open]>.wpr-discsum::before{content:"▾"}',
      '.wpr-discbody{padding:4px 0 2px}',
      '.wpr-subsec{margin:4px 0 0}',
      // 展开态里行尾注被内容取代（回落规则卡内已写明），避免同句读两遍 + 800px 下的截断
      '.wpr-subsec[open] .wpr-rownote{display:none}',
      // 行表（契约 / 手工条目 / 按模型覆盖）
      '.wpr-contract,.wpr-map-row{display:flex;gap:8px;align-items:center;padding:5px 0;border-top:1px solid var(--wpr-line-soft)}',
      '.wpr-contract:first-child,.wpr-map-row:first-child{border-top:0}',
      '.wpr-contract .wpr-in,.wpr-map-row .wpr-in{flex:1 1 0;min-width:0}',
      '.wpr-arrow{color:var(--wpr-t3);flex:0 0 auto}',
      '.wpr-ctext{flex:1;min-width:0;white-space:pre-wrap;word-break:break-word}',
      '.wpr-strike{opacity:.6}',
      '.wpr-quote{border-left:2px solid var(--wpr-line);padding:2px 0 2px 8px;margin:4px 0;color:var(--wpr-t2);white-space:pre-wrap;word-break:break-word}',
      '.wpr-cmd{display:flex;align-items:center;gap:8px;padding:6px 10px;border:1px dashed var(--wpr-line);border-radius:var(--wpr-r-ctl);background:var(--wpr-inset-bg)}',
      // 三段预览
      '.wpr-seg{border:1px solid var(--wpr-line);border-radius:var(--wpr-r-ctl);margin:6px 0;overflow:hidden;background:var(--wpr-inset-bg)}',
      '.wpr-seghead{display:flex;align-items:center;gap:8px;width:100%;padding:6px 10px;border:0;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer;text-align:left}',
      '.wpr-seghead:hover{background:var(--wpr-hover)}',
      '.wpr-caret{font-size:9px;opacity:.7;width:10px;flex:none}',
      '.wpr-pre{margin:0;padding:8px 10px;border-top:1px solid var(--wpr-line-soft);max-height:520px;overflow:auto;white-space:pre-wrap;',
      'word-break:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.6;user-select:text;-webkit-user-select:text}',
      '.wpr-empty{color:var(--wpr-t3);font-style:italic}',
      '.wpr-off{opacity:.6}',
      '.wpr-footline{margin-top:10px;color:var(--wpr-t3);font-size:12px}',
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
        // 二级开关：人设段（persona.enabled，出厂 true）。面板平时不暴露它，只在异常态（总开关开 + 这段关）
        // 显示一枚徽标 —— 否则用户会遇到"已启用却什么都不注入"而无从排查。
        personaOn: !(raw.persona && raw.persona.enabled === false),
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
          // 宿主下发了 ≠ 面板拿得到：这里是一层显式字段白名单，漏一个字段就是"静默丢字段"
          // （2026-09-19 实测：宿主 payload 有 inboxPending=1，但没在这里映射 → 卡片那句永远不显示）
          inboxPending: numOf(mem.inboxPending),
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

    /**
     * 折叠块（2026-09-19 新增，零依赖）：原生 <details>/<summary> —— 键盘可操作、屏幕阅读器认得，
     * 内容默认仍在渲染树/DOM 里（只是不显示），所以「默认收起」不会把内容从树上删掉（机检断言靠这条）。
     * 默认关闭：只有显式 open:true 才带 open 属性。
     */
    function Disclosure(props) {
      var attrs = { className: 'wpr-disc' + (props.className ? ' ' + props.className : '') };
      if (props.open === true) attrs.open = true;
      return h('details', attrs,
        h('summary', { className: 'wpr-discsum' }, props.summary),
        h('div', { className: 'wpr-discbody' }, props.children));
    }

    /** 分组小标题：轻量一行（组间距 > 组内卡片间距，层级靠间距不靠色块） */
    function GroupTitle(props) {
      return h('div', { className: 'wpr-group' },
        h('span', null, props.text),
        props.hint ? h('span', { className: 'wpr-sub' }, props.hint) : null);
    }

    /** 卡片头：标题 + 可选徽标/副文本（三张卡共用一行形态） */
    function CardHead(props) {
      return h('div', { className: 'wpr-cardhead' },
        h('div', { className: 'wpr-title' }, props.title),
        props.badge || null,
        props.sub ? h('span', { className: 'wpr-sub' }, props.sub) : null,
        props.right || null);
    }
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
        ref: ref, className: props.className || 'wpr-in', type: 'text', value: props.value, disabled: !!props.disabled,
        spellCheck: false, placeholder: props.placeholder || '', onChange: change,
      });
    }

    function Seg(props) {
      // 默认收起（2026-09-19）：三段正文在默认视图里不占屏，摘要行仍然给出字符数 ——
      var o = useState(false);
      var open = o[0];
      var setOpen = o[1];
      // 卡头「全部展开/收起」用 force + token 推给三段：token 每次点都变，所以同方向连点也生效；
      // 两下按钮之间每段仍能各自点开（不是受控组件）
      useEffect(function () {
        if (props.force !== undefined) setOpen(!!props.force);
      }, [props.token]);
      var text = strOf(props.text);
      return h('div', { className: 'wpr-seg' },
        h('button', {
          className: 'wpr-seghead', type: 'button',
          onClick: function () { setOpen(!open); },
        },
          h('span', { className: 'wpr-caret' }, open ? '▾' : '▸'),
          h('span', { className: 'wpr-title' }, props.title),
          h('span', { className: 'wpr-spacer' }),
          h('span', { className: 'wpr-dimnote' }, text ? (text.length + ' 字符') : '空 —— 不注入')),
        open ? h('pre', { className: 'wpr-pre' + (text ? '' : ' wpr-empty') }, text ? text : EMPTY_SEG) : null);
    }

    /**
     * 顶部状态条（2026-09-19 重排）：原来是一张占半屏的「状态」大卡，现在压成两行 ——
     * ①「[✓] ● 已启用 · flash 档 · 思维链 [off]」：勾选框就长在状态上（开关状态全页只出现这一处）
     * ②「配置：<路径> [复制路径]」
     * 「还没写配置 = 装上零行为改变」只在文件不存在时多一行；档位判定规则等说明收进折叠。
     * 样式只有一层、永远跟随宿主（2026-09-19 收口：不留任何自带外观开关）。
     */
    function StatusStrip(props) {
      var d = props.data;
      var st = d.configState || {};
      var label = strOf(d.tierLabel) || (d.tier + ' 档');   // 老宿主没这个字段时用档位 id 兜底，仍然不显示模型 id
      return h('div', { className: 'wpr-card wpr-status' },
        h('div', { className: 'wpr-statusline' },
          h('label', { className: 'wpr-chk' },
            h('input', {
              type: 'checkbox', checked: !!props.enabled, disabled: !!props.disabled,
              // 无可见标签（状态文字就在旁边），但读屏要有名字：沿用原来那句开关文案
              'aria-label': '启用（关掉 = 三段都不注入）',
              onChange: function (ev) { props.onToggleEnabled(!!(ev && ev.target && ev.target.checked)); },
            })),
          h('span', { className: 'wpr-dot' + (props.enabled ? ' wpr-dot-on' : '') }, '●'),
          h('span', null, props.enabled ? '已启用' : '已停用'),
          // 异常态：总开关开着、人设段却被关掉了 —— 这时候三段都不注入，必须点名
          (props.enabled && props.personaOn === false)
            ? h('span', { className: 'wpr-badge wpr-off', title: 'config.json 里 persona.enabled=false：人设段不注入（总开关之外的二级开关）' }, '人设段关')
            : null,
          h('span', { className: 'wpr-sep' }, '·'),
          h('span', null, label),
          h('span', { className: 'wpr-sep' }, '·'),
          h('span', null, '思维链'),
          h(TextInputWithList, {
            listId: 'wpr-thinking-langs', className: 'wpr-in wpr-inline', value: props.thinkingLanguage,
            disabled: !!props.disabled, placeholder: 'off / zh-CN / en，也可自填', onChange: props.onThinking,
          }),
          h('datalist', { id: 'wpr-thinking-langs' }, THINKING_PRESETS.map(function (t) {
            return h('option', { key: t, value: t });
          }))),
        h('div', { className: 'wpr-statusline' },
          h('span', { className: 'wpr-dimnote' }, '配置'),
          h('span', { className: 'wpr-mono' }, d.configPath || '（宿主未返回 configPath）'),
          d.configPath ? h(CopyBtn, { key: 'cp', text: d.configPath, label: '复制路径' }) : null),
        st.exists ? null : h('div', { className: 'wpr-alert' }, '还没写配置 = 装上零行为改变：不写文件就什么都不注入，不动你现有的人设。'),
        props.enabled ? null : h('div', { className: 'wpr-alert' }, '⚠ 当前无人设：enabled=false —— 这三段都不注入，系统提示词里没有人设内容。'),
        h(Disclosure, { summary: '档位怎么判定 · 文件与生效时机' },
          h('div', { className: 'wpr-note' }, strOf(d.tierRule) || '（宿主未返回档位判定规则）'),
          h('div', { className: 'wpr-note' }, '配置文件' + (st.exists ? ('：' + st.bytes + ' 字节') : '：还没写（装上零行为改变）') + ' · 改配置下一步生效；改挂载行要新会话。'),
          h('div', { className: 'wpr-note' }, '思维链语言：off = 不干预（跟随模型）；下拉是预设，也能直接敲别的值。'),
),
      );
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
        h('button', {
          className: 'wpr-btn', type: 'button', disabled: disabled || !!props.loading,
          onClick: props.onRefresh, title: '丢弃未保存改动，重新读取 /whale-persona/api/summary',
        }, props.loading ? '读取中…' : '刷新'),
        h('button', {
          className: 'wpr-btn wpr-primary' + (props.dirty ? ' wpr-dirty' : ''), type: 'button',
          disabled: disabled || !!props.saving || (!props.dirty && !!props.hasConfig),
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
      // 注入体积（0.13.0）：字符数直接取**这段文本自身**的长度（面板算的 == 运行期注入的，不是估的）；
      // 分段明细（人设/备忘/纪律）与预算判定来自 /summary 的 injection（与 CLI 共用 core/measure.js）。
      var inj = props.injection || null;
      var injBudget = (inj && inj.budget) ? inj.budget : null;
      var totalChars = strOf(sec.prefix).length + strOf(sec.thinking).length + strOf(sec.suffix).length;
      var budgetText = !injBudget ? ''
        : !injBudget.enabled ? '预算未启用（budget.enabled=false）：只显示体积，不做提醒'
        : !injBudget.max ? '已启用但没设上限（max=0）：只计量不提醒'
        : injBudget.over
          ? ('⚠ 超预算：' + inj.total + ' / ' + injBudget.max + ' 字符' + (injBudget.noteChars ? '（末尾段已注入提醒行）' : '（warnInPrompt=false：只在这里报）'))
          : ('预算 ' + injBudget.max + ' 字符，余量 ' + (injBudget.max - inj.total));
      // 2026-09-19 外部评审采纳：验证"我改完注入了什么"要逐个点开三段太啰嗦，卡头给一个一次性开关。
      // 只在卡头加按钮 —— 永远不往折叠行里塞派生/截断文本（"与运行期逐字一致"是这块的卖点）。
      var all = useState(false);
      var allOpen = all[0];
      var setAllOpen = all[1];
      var tickState = useState(0);
      var tick = tickState[0];
      var setTick = tickState[1];
      function toggleAll() { setAllOpen(!allOpen); setTick(tick + 1); }
      return h('div', { className: 'wpr-card' },
        h('div', { className: 'wpr-cardhead' },
          h('div', { className: 'wpr-title' }, '实际注入的三段'),
          h('span', { className: 'wpr-sub' },
            (props.fromSave ? '已按服务端返回的就地更新 · ' + props.tier + ' 档' : '与运行期同一套渲染 —— 展开逐段看原文')
            + ' · 合计 ' + totalChars + ' 字符'),
          h('span', { className: 'wpr-spacer' }),
          h('button', { className: 'wpr-btn wpr-icon', type: 'button', onClick: toggleAll }, allOpen ? '全部收起' : '全部展开')),
        h(Seg, { key: 'p', title: '人设前缀（prefix）', text: sec.prefix, force: allOpen, token: tick }),
        h(Seg, { key: 't', title: '思维链语言段（thinking）', text: sec.thinking, force: allOpen, token: tick }),
        h(Seg, { key: 's', title: '人设后缀（suffix）', text: sec.suffix, force: allOpen, token: tick }),
        inj ? h(Disclosure, { summary: '注入体积（合计 ' + totalChars + ' 字符）' },
          h('div', { className: 'wpr-note' }, '按 ' + strOf(inj.model) + ' 渲染计量；与 CLI（node scripts/inject-size.mjs）同一套算法：'),
          arrOf(inj.parts).map(function (p, i) { return h('div', { className: 'wpr-sub', key: 'ip' + i }, p.label + '：' + p.chars + ' 字符'); }),
          h('div', { className: 'wpr-note' }, budgetText)) : null);
    }

    /**
     * 人设预设卡（0.10.0）：一张卡 = 一个人格文件（可切换 / 可分享 / 可导入酒馆角色卡）。
     * 数据全部来自宿主路由 —— 面板自己不做解析，免得与 CLI、核心库各算一份。
     * 状态用"盒子 + 整体 set"的写法（与本文件其它卡片一致）：桩 React 里也能渲染。
     */
    function PresetCard(props) {
      // props.presets / props.dir 是给**静态预览页**与测试用的初始值（真页面靠下面的 fetch 刷新）
      var box = {
        presets: arrOf(props.presets), dir: strOf(props.dir), msg: '', bad: false, busy: false,
        paste: '', newId: 'my-persona', newLabel: '', report: null,
      };
      var stP = React.useState(box);
      var s = stP[0];
      var setS = stP[1];
      function upd(patch) {
        for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) box[k] = patch[k];
        setS({
          presets: box.presets, dir: box.dir, msg: box.msg, bad: box.bad, busy: box.busy,
          paste: box.paste, newId: box.newId, newLabel: box.newLabel, report: box.report,
        });
      }

      function reload() {
        return fetch(PRESETS_API, { headers: { accept: 'application/json' } }).then(readBody).then(function (res) {
          var d = res && res.data;
          if (!d || d.ok === false) throw new Error((d && d.error) || ('HTTP ' + (res && res.status)));
          upd({ presets: arrOf(d.presets), dir: strOf(d.dir) });
        }, function (e) { upd({ bad: true, msg: '读取预设失败：' + messageOf(e) }); });
      }
      React.useEffect(function () { reload(); }, []);

      function post(action, payload, okMsg) {
        upd({ busy: true, msg: '处理中…', bad: false });
        return fetch(PRESETS_API + '/' + action, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(payload || {}),
        }).then(readBody).then(function (res) {
          var d = res && res.data;
          if (res && typeof res.status === 'number' && (res.status < 200 || res.status >= 300)) {
            throw new Error((d && d.error) || ('HTTP ' + res.status));
          }
          if (!d || d.ok === false) throw new Error((d && d.error) || '接口返回 ok=false');
          upd({ busy: false, bad: false, msg: okMsg || '完成', presets: arrOf(d.presets), report: d.report || box.report });
          if (d.autosave) upd({ msg: (okMsg || '完成') + '（现状已存为 autosave · 上次的人设）' });
          if (props.onApplied) props.onApplied();
          return d;
        }, function (e) { upd({ busy: false, bad: true, msg: '失败：' + messageOf(e) }); });
      }

      /** 导出后立刻回读，确保"导出的是此刻磁盘上那份" */
      function download(id, format) {
        fetch(PRESETS_API + '/export?id=' + encodeURIComponent(id) + '&format=' + encodeURIComponent(format || 'whale'),
          { headers: { accept: 'application/json' } }).then(readBody).then(function (res) {
          var d = res && res.data;
          if (!d || d.ok === false) throw new Error((d && d.error) || ('HTTP ' + (res && res.status)));
          var text = JSON.stringify(d.json, null, 2);
          var name = id + (format === 'tavern' ? '.tavern-v2.json' : '.whale-preset.json');
          var canBlob = typeof Blob === 'function' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
            && typeof document !== 'undefined' && typeof document.createElement === 'function';
          if (!canBlob) { upd({ bad: false, msg: '这个环境不支持下载，内容已打到控制台' }); console.log(text); return; }
          var url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
          var a = document.createElement('a');
          a.href = url; a.download = name;
          a.click();
          setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 1000);
          upd({ bad: false, msg: '已导出 ' + name });
        }, function (e) { upd({ bad: true, msg: '导出失败：' + messageOf(e) }); });
      }

      function pickFile(ev) {
        var f = ev && ev.target && ev.target.files && ev.target.files[0];
        if (!f) return;
        if (typeof FileReader !== 'function') { upd({ bad: true, msg: '这个环境读不了文件，请把 JSON 粘到下面的框里' }); return; }
        var rd = new FileReader();
        rd.onload = function () { upd({ paste: strOf(rd.result), msg: '已读入 ' + f.name + '，点「导入」' }); };
        rd.onerror = function () { upd({ bad: true, msg: '读文件失败' }); };
        rd.readAsText(f);
      }

      var rows = s.presets.map(function (p, i) {
        // 名称里已经写了"五条…"的（如「起点 · 五条通用工作契约」）不再追加「契约 5 条」——否则一行说两遍
        var labelHasCount = /[0-9一二三四五六七八九十]+\s*条/.test(String(p.label || ''));
        var meta = p.id + ((p.contracts && !labelHasCount) ? ' · 契约 ' + p.contracts + ' 条' : '') + (p.hasCharacter ? ' · 有正文' : '')
          + (p.hasTone ? ' · 有语气' : '') + (p.hasAppearance ? ' · 有形象' : '') + (p.author ? ' · ' + p.author : '');
        return h('div', { className: 'wpr-contract', key: 'p' + i },
          h('span', { className: 'wpr-sub' }, (p.label || p.id) + ' — ' + meta),
          h('button', { className: 'wpr-btn wpr-primary', type: 'button', disabled: s.busy, title: '应用这个预设（现状先自动存为 autosave）', onClick: function () { post('apply', { id: p.id }, '已应用 ' + p.id + ' · 下一步生效'); } }, '应用'),
          h('button', { className: 'wpr-btn', type: 'button', disabled: s.busy, title: '导出为酒馆 v2 角色卡（可拿去分享/导入其它客户端）', onClick: function () { download(p.id, 'tavern'); } }, '导出卡'),
          h('button', { className: 'wpr-btn', type: 'button', disabled: s.busy, title: '导出为本引擎预设文件', onClick: function () { download(p.id, 'whale'); } }, '导出'),
          h('button', { className: 'wpr-btn wpr-icon wpr-danger', type: 'button', disabled: s.busy, title: '删除这个预设文件（不可撤销）', onClick: function () { post('delete', { id: p.id }, '已删除 ' + p.id); } }, '删除'));
      });

      var report = null;
      if (s.report) {
        var parts = [];
        if (arrOf(s.report.mapped).length) parts.push('已映射：' + arrOf(s.report.mapped).join(' / '));
        if (arrOf(s.report.unmapped).length) parts.push('不承接：' + arrOf(s.report.unmapped).join(' / '));
        for (var ni = 0; ni < arrOf(s.report.notes).length; ni++) parts.push(arrOf(s.report.notes)[ni]);
        report = h('div', { className: 'wpr-note' }, parts.join('　·　'));
      }

      return h('div', { className: 'wpr-card' },
        h(CardHead, {
          title: '人设预设',
          sub: arrOf(s.presets).length + ' 个 · 应用后下一步生效 · 目录 ' + (s.dir || '（读取中）'),
        }),
        s.msg ? h('div', { className: s.bad ? 'wpr-warn' : 'wpr-sub' }, s.msg) : null,
        rows.length ? rows : h('div', { className: 'wpr-sub' }, '（还没有预设文件 —— 展开下面的「存为预设 · 导入」即可创建或导入）'),
        // 2026-09-19 外部评审采纳：这两个表单偶尔才用，常驻展开白占约 300px 纵向；默认收进折叠块。
        // 预设列表行保持常显（那才是要扫的）；注意 Disclosure 的内容仍在渲染树里，勿改成条件渲染。
        h(Disclosure, { summary: '存为预设 · 导入酒馆角色卡 / 本引擎预设' },
        h(Field, { label: '存为预设' },
          h(TextInput, { value: s.newId, disabled: s.busy, placeholder: 'id：只能字母数字_-', onChange: function (v) { upd({ newId: v }); } }),
          h(TextInput, { value: s.newLabel, disabled: s.busy, placeholder: '显示名（可留空）', onChange: function (v) { upd({ newLabel: v }); } }),
          h('button', {
            className: 'wpr-btn wpr-mt4', type: 'button', disabled: s.busy,
            onClick: function () { post('save', { id: s.newId, label: s.newLabel || s.newId }, '已存为预设 ' + s.newId); },
          }, '存为预设')),
        h(Field, { label: '导入' },
          h('textarea', {
            className: 'wpr-in', rows: 3, value: s.paste, spellCheck: false,
            placeholder: '把酒馆角色卡（v1/v2 JSON）粘到这里，或选一个 .json 文件',
            onChange: function (ev) { upd({ paste: strOf(ev && ev.target && ev.target.value) }); },
          }),
          h('input', { className: 'wpr-in wpr-mt4', type: 'file', accept: '.json,application/json', onChange: pickFile }),
          h('button', {
            className: 'wpr-btn wpr-mt4', type: 'button', disabled: s.busy,
            onClick: function () { post('import', { json: s.paste }, '导入完成（不会自动应用）'); },
          }, '导入'))),
        report,
        h(Disclosure, { summary: '预设是什么 · 与酒馆卡怎么对应 · 边界在哪' },
          h('div', { className: 'wpr-note' }, '预设 = 一个人格快照文件（character / 契约 / 自称 / 称呼 / 立场 / 语气 / 形象 / 思维链语言），放在上面的目录里，复制给别人即可分享。'),
          h('div', { className: 'wpr-note' }, '应用是"只覆盖预设里出现的字段"：没出现的字段、以及配置里别的工具的段，一律保持原样。'),
          h('div', { className: 'wpr-note' }, '预设**不含长期记忆**：记忆是你与这个 AI 之间发生过的事，不该被别人的卡覆盖。'),
          h('div', { className: 'wpr-note' }, '导入**不会自动启用**：先看上面「此刻注入什么」的三段全文，确认后再点应用。'),
          h('div', { className: 'wpr-note' }, '酒馆卡映射：description→立场正文、personality→立场、scenario→正文（场景）、system_prompt→逐条契约、post_history_instructions→后缀；'
            + 'first_mes / mes_example / 世界书（character_book）本引擎**不承接**（那要宿主能力），导入时会逐个点名。'),
          h('div', { className: 'wpr-note' }, '不支持 PNG 卡：那种卡要在酒馆里先导出成 JSON（本插件不解析不受信二进制）。')));
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
            c.on !== false ? null : h('span', { className: 'wpr-dimnote' }, '不注入')),
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
          className: 'wpr-btn wpr-mt8', type: 'button', disabled: !!props.disabled, onClick: props.onAdd,
        }, '+ 添加契约'),
        h(Disclosure, { summary: '契约怎么才有效' },
          h('div', { className: 'wpr-note' }, '契约是逐条勾选生效的：关掉的条目仍可编辑，只是不注入。'),
          h('div', { className: 'wpr-note' }, '写得具体可验证才有效：「结尾不要出现征询式问句」✅；「高质量」❌。5–10 条为宜。')));
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
        h(CardHead, {
          title: '长期记忆', badge: badge(props.enabled, '已开', '默认关'),
          sub: '手工 ' + list.length + ' 条 · 收件箱 ' + (m.inboxLines || 0) + ' 行'
            + (m.inboxPending ? (' · 待确认 ' + m.inboxPending + ' 条') : ''),
        }),
        h(Field, { label: '总开关' },
          h(CheckBox, {
            checked: !!props.enabled, disabled: !!props.disabled, label: '启用长期记忆',
            onChange: function (v) { props.onToggleEnabled(v); },
          })),
        h(Field, { label: '注入时机' },
          h('select', {
            className: 'wpr-sel', value: props.capture, disabled: !!props.disabled,
            onChange: function (ev) { props.onCapture(strOf(ev && ev.target && ev.target.value)); },
          },
            h('option', { value: 'on-demand' }, 'on-demand（默认：会话里 /memory on 才注入）'),
            h('option', { value: 'always' }, 'always（每轮都注入 · 旧行为）')),
          (props.capture === 'on-demand' || props.capture === 'always')
            ? null
            : h('div', { className: 'wpr-warn' }, '当前值「' + strOf(props.capture) + '」不在预设里，保存后照原样写入。')),
        h('div', { className: 'wpr-note' }, '手工条目：'),
        rows.length ? rows : h('div', { className: 'wpr-sub' }, '（还没有手工条目）'),
        h('button', {
          className: 'wpr-btn wpr-mt8', type: 'button', disabled: !!props.disabled, onClick: props.onAdd,
        }, '+ 添加条目'),
        h(Disclosure, { summary: '注入时机怎么选' },
          h('div', { className: 'wpr-note' }, '开着重启才读记忆，手工条目会进提示词；不开则不读不写，装上零行为改变。'),
          h('div', { className: 'wpr-note' }, '注入时机：on-demand = 会话里 /memory on 才注入；always = 每轮都注入（旧行为）。')),
        h(Disclosure, { summary: '收件箱历史（' + (m.inboxLines || 0) + ' 行）' }, recent),
      );
    }
    /**
     * 「按模型指定自称」那张卡的文案（2026-09-18 泛化后由调用点传入 —— 一字不改，
     * 用户与测试看到的都和泛化前一样；这里只是把文案从组件里搬出来，让形象 / 语气能复用同一个行编辑器）。
     */
    var SELF_NAME_CARD = {
      title: '按模型指定自称',
      subtitle: function (n) { return n + ' 条 · 按模型覆盖上面两档'; },
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
    /**
     * 按模型映射表（键 → 文本）的行编辑器：自称 / 形象 / 语气三处共用这一张卡，
     * 文案**全部由调用点 props 传入**（SELF_NAME_CARD / StyleSection）。
     *   plain: true → 当**卡内子块**用（形象 / 语气小节里），省掉外层卡片与标题，只留行、加号与说明。
     *   独立成卡时（自称卡）条目与说明整体收进 Disclosure：默认只留一行「编辑条目与匹配规则」。
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
          className: 'wpr-btn wpr-mt8', type: 'button', disabled: !!props.disabled, key: 'add', onClick: props.onAdd,
        }, '+ 添加一条'),
      ];
      for (var n = 0; n < notes.length; n++) body.push(h('div', { className: 'wpr-note', key: 'n' + n }, notes[n]));
      if (props.plain) return h('div', null, body);   // 卡内子块：外层卡片与折叠由 StyleSection 提供
      return h('div', { className: 'wpr-card' },
        h(CardHead, { title: props.title, sub: props.subtitle }),
        h(Disclosure, { summary: '编辑条目与匹配规则' }, body));
    }
    /**
     * 形象 / 语气卡（0.9.0）：两张卡同一套形状 —— 总开关 + 通用文本 + 按模型覆盖表。
     * 差别只有文案、占位符，以及语气多一排「预设」按钮（数据来自 summary.tonePresets，
     * 也就是 core/presets.js 唯一那份文案：点一下写进通用文本，用户还能继续手改）。
     * 「按模型覆盖表」是卡内子块（ByModelCard plain）：条目命中优先，没命中回落通用文本。
     */
    /**
     * 形象 / 语气的小节（2026-09-19 合卡用）：摘要一行 = 开关 + 小节名 + 开/关徽标 + 覆盖率，
     * 正文（通用文本 / 预设 / 按模型覆盖 / 说明）整体收进折叠 —— 关着的时候不再各占半屏。
     * 开关放在 <summary> 里：点它只切开关（stopPropagation），点别处才展开。
     */
    function StyleSection(props) {
      var rows = arrOf(props.rows);
      var presets = arrOf(props.presets);
      // 行尾注：2026-09-19 外部评审采纳 —— 原句在 800px 宿主里被截断（"1 条按模型覆…"），
      // 缩短到 4 个字以内；展开子卡时它还由 CSS 隐藏（同样的回落规则卡内已经说了）。
      var sub = rows.length ? ('按模型 ' + rows.length + ' 条') : '无覆盖';
      // 勾上「启用」的那一下自动展开：原来勾完开关却看不到下面要填的东西 = 开着开关零注入。
      // 载入时不展开（已经配好的卡不该再占半屏），只在「关 → 开」的跃迁上展开。
      var prevState = useState(props.enabled === true);
      var prevEnabled = prevState[0];
      var setPrevEnabled = prevState[1];
      var openState = useState(false);
      var opened = openState[0];
      var setOpened = openState[1];
      useEffect(function () {
        if (props.enabled === true && prevEnabled === false) setOpened(true);
        if (prevEnabled !== props.enabled) setPrevEnabled(props.enabled === true);
      }, [props.enabled]);
      return h('details', { className: 'wpr-disc wpr-subsec', open: opened === true ? true : undefined },
        h('summary', { className: 'wpr-discsum' },
          h('label', {
            className: 'wpr-chk',
            onClick: function (ev) { if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation(); },
          },
            h('input', {
              type: 'checkbox', checked: props.enabled === true, disabled: !!props.disabled,
              onChange: function (ev) { props.onToggleEnabled(!!(ev && ev.target && ev.target.checked)); },
            }),
            h('span', null, props.switchLabel)),
          h('span', { className: 'wpr-title' }, props.title),
          badge(props.enabled === true, '已启用', '默认关'),
          h('span', { className: 'wpr-spacer' }),
          h('span', { className: 'wpr-sub wpr-rownote' }, sub)),
        h('div', { className: 'wpr-discbody' },
          h('div', { className: 'wpr-hint' }, props.switchHint),
          h(Field, { label: '通用文本' },
            h(TextInput, {
              multiline: true, value: props.text, disabled: !!props.disabled,
              placeholder: props.placeholder, onChange: function (v) { props.onText(v); },
            }),
            h('div', { className: 'wpr-hint' }, '每行一条（注入时自动加「- 」）；支持 {selfName} / {userName} 占位符。')),
          presets.length ? h(Field, { label: '预设' },
            h('div', { className: 'wpr-row wpr-row-tight' }, presets.map(function (p) {
              return h('button', {
                className: 'wpr-btn', type: 'button', key: p.id, disabled: !!props.disabled, title: p.text,
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
          h('div', { className: 'wpr-note' }, props.note)));
    }

    /**
     * 单段卡（0.9.0 的形态，测试钩子仍在用）：一段 = 一张卡。
     * 面板里形象 / 语气已经合成一张 VoiceCard，这里保留同一个小节的卡壳。
     */
    function StyleCard(props) {
      var rows = arrOf(props.rows);
      var sub = rows.length
        ? (rows.length + ' 条按模型覆盖 · 未命中回落通用文本')
        : '没有按模型覆盖 · 只用通用文本';
      return h('div', { className: 'wpr-card' },
        h(CardHead, { title: props.title, badge: badge(props.enabled === true, '已启用', '默认关'), sub: sub }),
        h(Field, { label: '总开关' }, h(StyleSection, props)));
    }

    /**
     * 「我怎么说话」组的合并卡：形象 + 语气两个可折叠小节，各自带开/关徽标与开关；
     * 说明（switchHint / notes）跟着小节正文一起折叠，默认收起。
     */
    function VoiceCard(props) {
      return h('div', { className: 'wpr-card' },
        h(CardHead, {
          title: '形象与语气',
          sub: '注入在「立场正文」之后、「工作契约」之前',
        }),
        h(Field, { label: '总开关' },
          h('div', { className: 'wpr-fbody' },
            arrOf(props.sections).map(function (s) { return h(StyleSection, Object.assign({ key: s.key }, s)); }))));
    }
    function EditorCard(props) {
      var ed = props.editor || {};
      var port = ed.port || portOf(ed.url);
      var cmd = 'node scripts/ui.mjs --port ' + port;
      // 2026-09-18 用户问「这张卡是不能改还是什么情况」：它不是开关或配置项，是**另一个进程**的入口。
      // DSH 只能探测它在不在跑、帮你打开，不能代你启动（宿主里起常驻子进程要自己扛端口冲突与退出清理）。
      // 面板已能改全部字段，所以这张卡降级成一行入口（2026-09-19）：标题 + 打开/复制命令，其余收进折叠。
      return h('div', { className: 'wpr-card wpr-card-lite' },
        h('div', { className: 'wpr-cardhead' },
          h('div', { className: 'wpr-title' }, '本地编辑器（可选）'),
          ed.running ? badge(true, '在跑', '') : null,
          h('span', { className: 'wpr-spacer' }),
          ed.running
            ? h('button', {
              className: 'wpr-btn', type: 'button',
              onClick: function () {
                try { if (typeof window !== 'undefined' && typeof window.open === 'function') window.open(ed.url); } catch (e) { /* 被弹窗拦截：地址仍可复制 */ }
              },
            }, '打开')
            : h('button', { className: 'wpr-btn', type: 'button', disabled: true }, '打开（未运行）'),
          h(CopyBtn, { key: 'cp', text: cmd, label: '复制命令' })),
        h(Disclosure, { summary: '它是什么 · 怎么起 · 换端口 · ' + ed.url },
          h('div', { className: 'wpr-note' },
            '它是本仓自带的独立本地面板（两个宿主共用、与上面这张面板同一套读写纪律），不是 DSH 插件：'
            + '要你自己在终端起它一次，DSH 只能探测与打开。上面已经能改全部字段，这里留给不开 DSH 的场景与 ZCode 用户。'),
          h('div', { className: 'wpr-cmd' },
            h('span', { className: 'wpr-mono' }, cmd),
            h(CopyBtn, { key: 'cp2', text: cmd, label: '复制命令' })),
          h('div', { className: 'wpr-hint' }, '换端口：起的时候用 --port，或设环境变量 DSH_WHALE_UI_PORT（面板按它显示）。'),
          h('div', { className: 'wpr-footline' }, '改配置下一步生效；改挂载行要新会话。')));
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

    /**
     * 面板正文（卡序）—— 抽成纯函数：设置页与机检静态预览页（data/ui-design/preview-panel.mjs）
     * 共用同一份卡序，预览图因此不是手抄件。
     * o = { data, form, disabled, status, savedPreview, error, loading, handlers }
     * handlers = { patchForm, patchAt, removeAt, addAt, onRetry }：全是回调，纯渲染不碰状态。
     */
    function panelBody(o) {
      var d = o.data;
      var form = o.form;
      var disabled = !!o.disabled;
      var cb = o.handlers || {};
      var body = [];
      if (o.error) {
        body.push(h('div', { className: 'wpr-alert wpr-bad', key: 'err' },
          h('div', null, '读取失败：' + o.error),
          h('div', { className: 'wpr-sub wpr-mt4' }, '面板只是看不见人设，人设本身不受影响。'),
          h('button', { className: 'wpr-btn wpr-mt8', type: 'button', onClick: cb.onRetry }, '重试')));
      }
      if (!d && !o.error) {
        body.push(h('div', { className: 'wpr-sub', key: 'loading' },
          o.loading ? '正在读取人设…' : '没有数据 —— 点右上角「刷新」重试。'));
      }
      if (!d || !form) return body;

      var notes = [];
      if (!d.configValid) {
        // 坏 JSON 是**磁盘状态**，与宿主版本无关：先说这句，别被「老宿主」的提示盖过去
        notes.push('配置文件不是合法 JSON，设置面板不会覆盖它，请先手工修好。');
        if (!d.hasRaw) notes.push('另外：' + NO_RAW_HINT + '。');
      } else if (!d.hasRaw) {
        notes.push('注意：' + NO_RAW_HINT + '。');
      }
      if (d.warnings && d.warnings.length) {
        for (var wi = 0; wi < d.warnings.length; wi++) notes.push('⚠ ' + d.warnings[wi]);
      }
      var sv = o.status || { saving: false, saved: false, savedAt: '', error: '' };
      var savedPreview = o.savedPreview || null;
      var shown = savedPreview || { sections: d.sections, warnings: [] };
      // 「按模型」条目的关键词到底该写什么：用宿主**真实**注入用的 id，
      // 因为界面上的模型显示名（如「DeepSeek-V4.1-Flash High」）与 id（如 deepseek-flash）常常不是一回事。
      var seenModel = strOf(d.seenModel);
      var modelNotes = seenModel
        ? ['宿主最近一次真实注入用的模型 id 是「' + seenModel + '」—— 关键词照它写即可（忽略大小写，写其中一段也能命中）。']
        : [];

      body.push(h(Banner, { key: 'banner', status: sv, notes: notes }));
      // ① 顶部状态条（总开关 / 档位 / 思维链 / 配置路径都在这一张里，全页只出现一次）
      body.push(h(StatusStrip, {
        key: 'status', data: d, enabled: form.enabled, personaOn: d.personaOn !== false, thinkingLanguage: form.thinkingLanguage, disabled: disabled,
        onToggleEnabled: function (v) { cb.patchForm({ enabled: v }); },
        onThinking: function (v) { cb.patchForm({ thinkingLanguage: v }); },
      }));

      // ② 我是谁 —— 自称两档 / 按模型指定自称 / 称呼 / 立场与后缀
      body.push(h(GroupTitle, { key: 'g1', text: '我是谁', hint: '自称 · 称呼 · 立场' }));
      body.push(h('div', { className: 'wpr-card', key: 'who' },
        h(CardHead, { title: '称呼与自称' }),
        h(Field, { label: '自称 · flash 档' },
          h(TextInput, { value: form.selfNameFlash, disabled: disabled, onChange: function (v) { cb.patchForm({ selfNameFlash: v }); } })),
        h(Field, { label: '自称 · pro 档' },
          h(TextInput, { value: form.selfNamePro, disabled: disabled, onChange: function (v) { cb.patchForm({ selfNamePro: v }); } })),
        h(Field, { label: '它怎么称呼你' },
          h(TextInput, { value: form.userName, disabled: disabled, onChange: function (v) { cb.patchForm({ userName: v }); } })),
        h(Disclosure, { summary: '说明：自称与称呼怎么进提示词' },
          h('div', { className: 'wpr-note' }, '自称只通过 {selfName} 占位符进提示词 —— 写进「立场正文」或任一条契约里才生效；称呼同理（{userName}）。'),
          h('div', { className: 'wpr-note' }, '关掉总开关 = 三段都不注入，等于装上零行为改变（不是回到宿主的默认人设）。'))));
      body.push(h(ByModelCard, {
        key: 'bymodel', value: form.selfNameRows, disabled: disabled,
        title: SELF_NAME_CARD.title,
        subtitle: SELF_NAME_CARD.subtitle(form.selfNameRows.length),
        empty: SELF_NAME_CARD.empty,
        keyPlaceholder: SELF_NAME_CARD.keyPlaceholder,
        valuePlaceholder: SELF_NAME_CARD.valuePlaceholder,
        notes: SELF_NAME_CARD.notes.concat(modelNotes),
        onPatch: function (i, f) { cb.patchAt('selfNameRows', i, f); },
        onRemove: function (i) { cb.removeAt('selfNameRows', i); },
        onAdd: function () { cb.addAt('selfNameRows', seenModel); },
      }));
      body.push(h('div', { className: 'wpr-card', key: 'stance' },
        h(CardHead, { title: '立场与后缀' }),
        h(Field, { label: '立场（一句话）' },
          h(TextInput, {
            value: form.stance, disabled: disabled,
            placeholder: '例：{userName} 的编程搭档，直来直去。（选填；与下面正文都在就都注入）',
            onChange: function (v) { cb.patchForm({ stance: v }); },
          })),
        h(Field, { label: '立场正文' },
          h(TextInput, {
            multiline: true, value: form.character, disabled: disabled,
            placeholder: '整段自定义，支持 {selfName} / {userName}；与上一行都在就都注入，留空只注入上一行',
            onChange: function (v) { cb.patchForm({ character: v }); },
          })),
        h(Field, { label: '后缀' },
          h(TextInput, {
            value: form.suffix, disabled: disabled, placeholder: '追加在提示词末尾的一句，支持 {{cwd}}',
            onChange: function (v) { cb.patchForm({ suffix: v }); },
          })),
        h(Disclosure, { summary: '说明：{{cwd}} 与其它变量' },
          h('div', { className: 'wpr-note' }, '支持 {{cwd}}：设置页拿不到会话的工作目录，所以这里显示成 <当前工作目录>，会话里会被替换成真实路径；其余 {{变量}} 原样保留不解析。'))));

      // ③ 我怎么说话 —— 形象 + 语气合成一张卡，两个可折叠小节
      body.push(h(GroupTitle, { key: 'g2', text: '我怎么说话', hint: '形象 / 语气' }));
      body.push(h(VoiceCard, {
        key: 'voice',
        sections: [
          {
            key: 'appearance',
            title: '形象（appearance）',
            switchLabel: '启用形象设定',
            switchHint: '出厂默认关：关着的时候，下面填了内容也不会注入。',
            enabled: form.appearanceEnabled,
            text: form.appearanceText,
            placeholder: '例：你是一位资深后端工程师。',
            rows: form.appearanceRows,
            keyPlaceholder: '模型关键词，如 deepseek-v4.1-flash',
            valuePlaceholder: '这个模型下的形象，如 你是一位资深后端工程师。',
            empty: '（没配就所有模型都用上面的通用文本）',
            notes: [
              '形象是「你是谁／长什么样」的既定事实：不必解释、不要否认，也不要反复强调或拿它加戏；被问到年龄/性别/长相时照它回答。',
            ].concat(modelNotes),
            note: '关着时填的内容会留在配置里，打开开关即可生效。',
            disabled: disabled,
            onToggleEnabled: function (v) { cb.patchForm({ appearanceEnabled: v }); },
            onText: function (v) { cb.patchForm({ appearanceText: v }); },
            onPatch: function (i, f) { cb.patchAt('appearanceRows', i, f); },
            onRemove: function (i) { cb.removeAt('appearanceRows', i); },
            onAdd: function () { cb.addAt('appearanceRows', seenModel); },
          },
          {
            key: 'tone',
            title: '回复语气（tone）',
            switchLabel: '启用回复语气',
            switchHint: '出厂默认关：关着的时候，下面填了内容也不会注入。',
            enabled: form.toneEnabled,
            text: form.toneText,
            placeholder: '例：语气温柔有耐心：先接住对方的处境再给方案，但该说的问题照样直说。',
            rows: form.toneRows,
            keyPlaceholder: '模型关键词，如 glm-5.1',
            valuePlaceholder: '这个模型下的语气，如 语气严肃克制：先摆结论和依据。',
            empty: '（没配就所有模型都用上面的通用文本）',
            presets: arrOf(d.tonePresets),
            onUsePreset: function (text) { cb.patchForm({ toneText: text }); },
            notes: [
              '语气只改措辞与节奏：不改变结论、证据标准与工作契约。',
            ].concat(modelNotes),
            note: '关着时填的内容会留在配置里，打开开关即可生效。',
            disabled: disabled,
            onToggleEnabled: function (v) { cb.patchForm({ toneEnabled: v }); },
            onText: function (v) { cb.patchForm({ toneText: v }); },
            onPatch: function (i, f) { cb.patchAt('toneRows', i, f); },
            onRemove: function (i) { cb.removeAt('toneRows', i); },
            onAdd: function () { cb.addAt('toneRows', seenModel); },
          },
        ],
      }));

      // ④ 我的硬约束 —— 工作契约
      body.push(h(GroupTitle, { key: 'g3', text: '我的硬约束', hint: '逐条可勾选' }));
      body.push(h(ContractsCard, {
        key: 'contracts', value: form.contracts, disabled: disabled,
        onPatch: function (i, f) { cb.patchAt('contracts', i, f); },
        onRemove: function (i) { cb.removeAt('contracts', i); },
        onAdd: function () { cb.addAt('contracts'); },
      }));

      // ⑤ 我记住什么 —— 长期记忆（开关与条目在同一张卡里：原来拆两张既重复又不同步）
      body.push(h(GroupTitle, { key: 'g4', text: '我记住什么', hint: '长期记忆' }));
      body.push(h(MemoryCard, {
        key: 'memory', mem: d.memory, value: form.entries,
        enabled: form.memoryEnabled, capture: form.memoryCapture, disabled: disabled,
        onToggleEnabled: function (v) { cb.patchForm({ memoryEnabled: v }); },
        onCapture: function (v) { cb.patchForm({ memoryCapture: v }); },
        onPatch: function (i, f) { cb.patchAt('entries', i, f); },
        onRemove: function (i) { cb.removeAt('entries', i); },
        onAdd: function () { cb.addAt('entries'); },
      }));

      // ⑥ 此刻注入什么 —— 三段预览
      body.push(h(GroupTitle, {
        key: 'g5', text: '此刻注入什么',
        hint: (strOf(d.tierLabel) || (d.tier + ' 档')) + ' · 按模型档渲染，换档重取',
      }));
      body.push(h(SectionsCard, {
        key: 'sections', sections: shown ? shown.sections : d.sections, warnings: shown ? shown.warnings : [],
        tier: d.tier, fromSave: !!savedPreview, injection: d.injection,
      }));
      if (shown && shown.warnings && shown.warnings.length && savedPreview) {
        for (var sj = 0; sj < shown.warnings.length; sj++) {
          body.push(h('div', { className: 'wpr-alert', key: 'pw' + sj }, '⚠ ' + shown.warnings[sj]));
        }
      }
      // ⑦ 人设预设（0.10.0）—— 整组垫底：切换 / 另存 / 导入导出；应用后走 cb.onRetry 重读面板。
      // 2026-09-19 外部评审采纳：这是"偶尔用一次"的功能，压在首屏会把每天要改的
      // 称呼/立场挤到折叠以下；整组下沉到面板末尾，首屏留给高频项。
      body.push(h(GroupTitle, { key: 'g0', text: '人设预设', hint: '可切换 · 可分享 · 可导入酒馆卡' }));
      body.push(h(PresetCard, { key: 'presets', onApplied: cb.onRetry }));

      body.push(h(EditorCard, { key: 'editor', editor: d.editor }));
      return body;
    }

    /** 面板整页（页头 + 工具栏 + 正文）：设置页与静态预览页共用，保证预览与真页面同构 */
    function panelView(o) {
      var d = o.data;
      var form = o.form;
      var cb = o.handlers || {};
      return h('div', { className: 'wpr-wrap' },
        h('div', { className: 'wpr-head' },
          h('div', { className: 'wpr-h1' }, '人设 · whale-persona'),
          h('span', { className: 'wpr-spacer' }),
          h('span', { className: 'wpr-sub' }, '改配置下一步生效 · 改挂载行要新会话')),
        d && form ? h(Toolbar, {
          // 表单禁用时工具栏一起禁用（老宿主无 raw / 磁盘坏 JSON）：档位与保存都不该能点
          disabled: !!o.disabled, loading: !!o.loading, saving: !!o.saving, dirty: !!o.dirty, tier: o.tier,
          hasConfig: !!(d && d.configState && d.configState.exists),
          onPickTier: cb.onPickTier, onRefresh: cb.onRefresh, onSave: cb.onSave,
        }) : null,
        panelBody(o));
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

      return panelView({
        data: d, form: form, disabled: disabled, status: sv, savedPreview: savedPreview,
        error: st.error, loading: !!st.loading, tier: tier, saving: !!sv.saving, dirty: dirty,
        handlers: {
          patchForm: patchForm, patchAt: patchAt, removeAt: removeAt, addAt: addAt,
          onPickTier: pick, onRefresh: refresh, onSave: save,
          onRetry: function () { setTick(tick + 1); },
        },
      });
    }


    /* ── 条件反射（reflex，2026-09-20 并入人设插件）───────────────────────── */

    var REFLEX_STATE_API = '/whale-persona/api/reflex/state';
    var REFLEX_TEST_API = '/whale-persona/api/reflex/test';
    var RX_MUTED = 'var(--dsw-alias-text-2,#98a2ae)';
    var RX_CARD = { border: '1px solid rgba(255,255,255,.10)', borderRadius: '10px', padding: '10px 12px', marginBottom: '10px', background: 'rgba(255,255,255,.03)' };
    var RX_CHIP = { display: 'inline-block', padding: '1px 8px', borderRadius: '999px', fontSize: '12px', marginRight: '6px', border: '1px solid rgba(255,255,255,.14)' };
    var RX_CODE = { fontFamily: 'ui-monospace,Consolas,monospace', fontSize: '12px', wordBreak: 'break-all' };
    var RX_BTN = { padding: '3px 10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,.18)', background: 'transparent', color: 'inherit', cursor: 'pointer' };
    var RX_INPUT = { width: '100%', marginTop: '6px', padding: '5px 8px', borderRadius: '6px', border: '1px solid rgba(255,255,255,.18)', background: 'rgba(0,0,0,.18)', color: 'inherit' };

    function rxTone(text, tone) {
      var st = Object.assign({}, RX_CHIP);
      if (tone === 'on') st.background = 'rgba(76,141,255,.20)';
      if (tone === 'off') st.opacity = .55;
      if (tone === 'bad') { st.background = 'rgba(255,90,90,.18)'; st.borderColor = 'rgba(255,90,90,.45)'; }
      return h('span', { style: st }, text);
    }

    function rxActionText(r) {
      if (r.reply) return '照抄「' + r.reply + '」';
      return '注入约束' + (r.directive ? '：' + r.directive : '');
    }

    function rxChannelText(r) {
      return '通道：正则'
        + ((r.nearAny && r.nearAny.length) ? ' ＋ 近似 ' + r.nearAny.length + ' 条' : '')
        + ((r.keywords && r.keywords.length) ? ' ＋ 词袋 ' + r.keywords.length + ' 词（≥' + r.minHits + ' 命中算软命中）' : '');
    }

    /**
     * 条件反射面板：**只读**。
     * 设计取舍（2026-09-20）：面板只说真话 —— 区分"文件里写的"与"当前生效的"，
     * 试命中按 flash/pro/其它 三档各判一次（跨档报出），不给假状态。
     * 不给输入框、不给开关：规则是个人资产，改规则走"让 AI 改文件 + scripts/reflex.mjs 体检"。
     */
    function ReflexPanel() {
      var s = React.useState(null); var st = s[0]; var setSt = s[1];
      var e1 = React.useState(''); var err = e1[0]; var setErr = e1[1];
      var q = React.useState(''); var query = q[0]; var setQuery = q[1];
      var tr = React.useState(null); var trial = tr[0]; var setTrial = tr[1];
      var timer = React.useRef(null);

      function load() {
        fetch(REFLEX_STATE_API, { cache: 'no-store' }).then(function (r) { return r.json(); })
          .then(function (j) { setSt(j); setErr(''); })
          .catch(function (x) { setErr(String((x && x.message) || x)); });
      }
      React.useEffect(function () { load(); }, []);

      if (err) return h('div', { style: RX_CARD }, '读不到条件反射状态：' + err);
      if (!st) return h('div', { style: { color: RX_MUTED } }, '读取中…');

      var rows = (st.rules || []).map(function (r) {
        return h('div', { key: r.id, style: RX_CARD },
          h('div', null, rxTone(r.tier === 'any' ? '任意档' : r.tier, 'on'), r.oncePerSession ? rxTone('每会话一次', 'off') : null, h('b', null, r.id)),
          h('div', { style: { color: RX_MUTED, marginTop: '4px', fontSize: '13px' } }, '触发：', h('span', { style: RX_CODE }, r.text || (r.model ? 'model~' + r.model : '(无条件)'))),
          h('div', { style: { marginTop: '4px', fontSize: '13px' } }, '动作：', rxActionText(r)),
          (r.tools && r.tools.length) ? h('div', { style: { marginTop: '4px', fontSize: '12px', color: RX_MUTED } }, '本步只留工具：' + r.tools.join(' / ') + '（规则文件里 toolNarrowing=true 才生效）') : null,
          h('div', { style: { color: RX_MUTED, marginTop: '4px', fontSize: '12px' } }, rxChannelText(r) + '　|　已命中 ' + ((st.log && st.log.byRule && st.log.byRule[r.id]) || 0) + ' 次'));
      });

      var last = st.log && st.log.last;
      return h('div', { style: { maxWidth: '860px' } },
        h('div', { style: RX_CARD },
          h('div', null,
            rxTone(st.effective ? '生效中' : '当前无规则生效', st.effective ? 'on' : 'bad'),
            rxTone(st.enabled ? '总开关：开' : '总开关：关', st.enabled ? 'on' : 'off'),
            rxTone(st.dryRun ? 'dryRun（只记账不动作）' : 'dryRun：关', st.dryRun ? 'bad' : 'off'),
            st.shell === 'off-by-env' ? rxTone('环境变量已全关', 'bad') : null),
          st.broken ? h('div', { style: { color: '#ff8a8a', marginTop: '6px' } }, '规则文件坏了：' + st.broken + '（现在一条都不生效，去修文件）') : null,
          !st.fileExists ? h('div', { style: { color: RX_MUTED, marginTop: '6px' } }, '还没有规则文件（装上零行为改变）：' + st.file) : null,
          st.fileExists && !st.broken && st.fileRuleCount !== (st.rules || []).length
            ? h('div', { style: { color: '#ffd479', marginTop: '6px' } }, '注意：文件里写了 ' + st.fileRuleCount + ' 条，实际生效 ' + (st.rules || []).length + ' 条（缺 id 或缺动作的条目被丢掉了）') : null,
          h('div', { style: { color: RX_MUTED, marginTop: '6px', fontSize: '12px' } }, '规则文件：', h('span', { style: RX_CODE }, st.file)),
          h('div', { style: { marginTop: '8px' } }, h('button', { onClick: load, style: RX_BTN }, '刷新'))),
        rows.length ? h('div', null, rows) : h('div', { style: { color: RX_MUTED } }, '还没有任何条件反射。'),
        h('div', { style: Object.assign({}, RX_CARD, { color: RX_MUTED, fontSize: '13px' }) },
          h('div', null, '命中台账：fire ' + ((st.log && st.log.fire) || 0) + ' 次 / dry-run ' + ((st.log && st.log.dryRun) || 0) + ' 次'),
          last ? h('div', { style: { marginTop: '4px' } }, '最近一次：' + last.t + ' ' + last.phase + ' ' + last.rule + (last.head ? '　原话「' + last.head + '」' : '')) : h('div', { style: { marginTop: '4px' } }, '还没有命中记录')),
        h('div', { style: RX_CARD },
          h('b', null, '试命中（只测，不改任何东西）'),
          h('div', { style: { color: RX_MUTED, fontSize: '12px', marginTop: '4px' } }, '把你打算说的话粘进来，看会不会触发；不命中就说明该补规则或改说法。规则可分档写，这里按 flash / pro / 其它 三档各判一次。'),
          h('input', {
            value: query, placeholder: '例如：那你知道自己的身份吗？',
            onChange: function (ev) {
              var v = ev.target.value;
              setQuery(v);
              if (timer.current) clearTimeout(timer.current);
              if (!v.trim()) { setTrial(null); return; }
              timer.current = setTimeout(function () {
                fetch(REFLEX_TEST_API + '?q=' + encodeURIComponent(v), { cache: 'no-store' })
                  .then(function (r) { return r.json(); })
                  .then(function (j) { setTrial(Object.assign({ query: v }, j)); })
                  .catch(function (x) { setTrial({ query: v, error: String((x && x.message) || x) }); });
              }, 300);
            },
            style: RX_INPUT,
          }),
          h('div', { style: { marginTop: '6px', fontSize: '13px' } }, (function () {
            if (!query) return '还没输入';
            if (!trial || trial.query !== query) return '判定中…';
            if (trial.error) return '判不了：' + trial.error;
            if (!trial.matched) return '不会命中任何规则 → 按原样问模型（已按 flash / pro / 其它 三档各判一次）';
            var hits = trial.hits || [];
            if (!hits.length) return '会命中：' + trial.ruleId + '（通道 ' + trial.why + ')';
            return '会命中：' + hits.map(function (x) {
              return x.ruleId + '（档位 ' + x.tier + '，通道 ' + x.why + (x.soft ? '，软命中：不符会自动忽略' : '') + '）';
            }).join('；');
          })())),
        h('div', { style: Object.assign({}, RX_CARD, { fontSize: '13px' }) },
          h('b', null, '这一页只读。要改就交给你的 AI：'),
          h('div', { style: { marginTop: '4px' } }, '「帮我加一条条件反射：<什么时候> → <怎么做>」'),
          h('div', { style: { marginTop: '4px', color: RX_MUTED } }, '改完让它跑 node scripts/reflex.mjs check（退出码 0 才算改完），本页点刷新即见。')));
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
          PresetCard: PresetCard,     // 预设卡（0.10.0）：测试要能拿真数据渲染它（桩里 useEffect 不跑）
          // 静态预览页（data/ui-design/preview-panel.mjs）要用：整页树 + 样式字符串 + 各张卡
          css: CSS,
          panelView: panelView,
          panelBody: panelBody,
          StateCard: StatusStrip,        // 旧名字保留：它现在就是顶部状态条（StatusStrip）
          StatusStrip: StatusStrip,
          Disclosure: Disclosure,
          GroupTitle: GroupTitle,
          CardHead: CardHead,
          StyleSection: StyleSection,
          VoiceCard: VoiceCard,

          Toolbar: Toolbar,
          Banner: Banner,
          ContractsCard: ContractsCard,
          MemoryCard: MemoryCard,
          SectionsCard: SectionsCard,
          EditorCard: EditorCard,
          Field: Field,
          badge: badge,
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
          style.dataset.plugin = BASE_TAG;          // 基础层：永远注入，且只此一层
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

      // 第二个整页：条件反射（只读）。插槽不存在也不连累设置页
      ctx.effect(function () {
        try {
          return ctx.slots.inject('settings.section', function () {
            return ctx.slots.register({
              name: 'settings.section',
              id: 'whale-persona-reflex',
              order: 130,
              label: function () { return '条件反射'; },
            }, function WhaleReflexSettingsWithBoundary() {
              return h(Boundary, null, h(ReflexPanel, null));
            });
          });
        } catch (e) {
          return function () {};
        }
      }, 'whale-persona: reflex section');
    };

    return module.exports;
  },
});
