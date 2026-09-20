/**
 * check —— 规则文件体检 + 试命中。给「让 AI 改配置」这条路径用的闸门：
 * 任何 AI 改完 reflex.json，都必须先跑这个，再让用户去用（没有它，用户就是小白鼠）。
 *
 * 跑法：
 *   node scripts/reflex.mjs check                      # 体检当前规则文件
 *   node scripts/reflex.mjs check --hit '你知道自己的身份吗'                  # 试命中：不写 --tier = 跨档试（flash/pro/其它）
 *   node scripts/reflex.mjs check --hit '你知道自己的身份吗' --tier flash      # 只按 flash 档判（与真实会话同口径）
 * 退出码：0=无错误（警告不影响）；1=有错误。
 */
import { readFileSync, existsSync } from 'node:fs'
import { rulesPath } from '../../adapters/dsh/reflex/rules.js'
import { reflexTest } from '../../adapters/dsh/reflex/state.js'

/** 粗判灾难性回溯（ReDoS 形状）：分组里已有量词、分组外又套量词，或含歧义分支的分组再套量词。
 *  只提示、不拦写盘 —— 信任边界见 .github/SECURITY.md「已知设计约束」（正则是你自己写的，不做沙箱）。 */
function looksCatastrophic(re) {
  if (typeof re !== 'string' || !re || re.length > 300) return false
  return /\(([^()]*[+*][^()]*)\)\s*[+*]/.test(re) || /\(([^()]*\|[^()]*)\)\s*[+*]/.test(re)
}

const argv = process.argv.slice(2)
const argOf = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null }
const file = rulesPath()
if (!existsSync(file)) { console.log('!! 规则文件不存在：' + file); process.exit(1) }

let cfg = null
try { cfg = JSON.parse(readFileSync(file, 'utf8')) } catch (e) { console.log('!! JSON 解析失败：' + e.message); process.exit(1) }
const errors = []; const warns = [];
if (typeof cfg.enabled !== 'boolean') warns.push('enabled 不是布尔（默认按开处理）');
if (typeof cfg.dryRun !== 'boolean') warns.push('dryRun 不是布尔（默认按关处理）');
if (!Array.isArray(cfg.rules)) errors.push('rules 必须是数组');
const rules = Array.isArray(cfg.rules) ? cfg.rules : [];
const ids = new Set();
rules.forEach((r, i) => {
  const at = 'rules[' + i + ']';
  if (!r || typeof r !== 'object') { errors.push(at + ' 不是对象'); return }
  if (!r.id || typeof r.id !== 'string') errors.push(at + ' 缺 id');
  else if (ids.has(r.id)) errors.push(at + ' id 重复：' + r.id); else ids.add(r.id);
  const t = r.then || {};
  if (!t.reply && !t.directive) errors.push(at + ' 没有动作（then.reply / then.directive 至少一个）');
  const w = r.when || {};
  if (w.tier && ['flash', 'pro', 'any'].indexOf(w.tier) < 0) errors.push(at + ' when.tier 只能是 flash/pro/any，现在是 ' + w.tier);
  for (const k of ['text', 'textNot', 'model']) {
    if (!w[k]) continue;
    try { new RegExp(w[k], 'i') } catch (e) { errors.push(at + ' when.' + k + ' 正则编译失败：' + e.message) }
    if (looksCatastrophic(w[k])) warns.push(at + ' when.' + k + ' 像灾难性回溯（嵌套量词），长消息上会卡顿：' + w[k])
  }
  if (!w.tier && !w.text && !w.model) warns.push(at + ' 没有任何条件（会命中所有消息）');
  if (r.oncePerSession !== undefined && typeof r.oncePerSession !== 'boolean') warns.push(at + ' oncePerSession 不是布尔');
  if (t.tools !== undefined) {
    if (!Array.isArray(t.tools)) errors.push(at + ' then.tools 必须是字符串数组（步级工具裁剪的白名单）');
    else if (t.tools.some((n) => typeof n !== 'string' || !n.trim())) errors.push(at + ' then.tools 里有空名字或非字符串');
    else if (t.tools.includes('run_code')) warns.push(at + ' then.tools 点名了宿主的保留传输名 run_code（restrict 会拒绝），已按"不认识的工具"跳过');
    else if (cfg.toolNarrowing !== true) warns.push(at + ' 声明了 then.tools 但规则文件里没有 "toolNarrowing": true —— 现在**不会**裁工具');
  }
  if (cfg.toolNarrowing === true && !(t.tools && t.tools.length)) { /* 开关开着但这条规则不裁：正常 */ }
  if (r.priority !== undefined && typeof r.priority !== 'number') warns.push(at + ' priority 不是数字');
});

const hitText = argOf('--hit');
if (hitText !== null) {
  // 档位语义与面板同一份（lib/state.js:reflexTest）：**不写 --tier 就是跨档试**。
  // 2026-09-20 踩到：旧版这里兜成 tierOf('') = 'other'，规则是分档写的 → 明明会命中却报「没命中」。
  const t = reflexTest(hitText, argOf('--tier') || '', argOf('--model') || '');
  console.log('试命中：' + (t.tierExplicit ? '档位=' + t.tier : '档位=跨档试（' + t.tiersTried.join('/') + '）') + ' 原话=' + JSON.stringify(hitText));
  if (!t.matched) console.log('  → 没有命中任何规则（按原样放行）');
  else {
    for (const h of t.hits) {
      const then = ((rules.find((r) => r && r.id === h.ruleId) || {}).then) || {};
      console.log('  → [档位 ' + h.tier + '] 命中规则 ' + h.ruleId + '（通道 ' + h.why + (h.soft ? '，软命中' : '') + '）：' + (then.reply ? '照抄「' + then.reply + '」' : '注入约束'));
    }
    if (!t.tierExplicit) console.log('  注：真实会话只会落在其中一个档位（按你当时用的模型）；上面列的档位都会触发这条规则。');
  }
}

console.log('规则文件：' + file + '（' + rules.length + ' 条）');
for (const w of warns) console.log('WARN  ' + w);
for (const e of errors) console.log('ERROR ' + e);
console.log(errors.length ? '-- 体检：' + errors.length + ' 个错误，驳回改动（先修再交付）' : '-- 体检：通过' + (warns.length ? '（' + warns.length + ' 条警告）' : ''));
process.exit(errors.length ? 1 : 0);
