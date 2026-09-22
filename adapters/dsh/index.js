/**
 * whale-persona —— 多宿主人设引擎（DSH 宿主壳，无构建、纯 ESM）
 *
 * 它做一件事：把系统提示词的人设段变成**可开关、可自定义、可记忆**的产物。
 *   - 开：注入本插件渲染的人设（遮蔽部署级默认）
 *   - 关：返回空文本 —— 段消失，没有本插件人设
 *   - 绝不注销变量、绝不抛错：装配期任何异常都降级成空文本
 *
 * 与官方 @deepseek-ai/dsh-persona 的关系（2026-09-18 依第一方源码修正口径）：
 *   两者占同一个架构位——「preset 级 persona 遮蔽行」。挂载规则看层：
 *   跨层同名 = 遮蔽（官方替换机制，本插件在 agent preset 层遮蔽部署级默认）；
 *   同层同名 = 装配抛错（同一 preset 里已挂官方行就先卸掉它）；
 *   全局/profile 层挂载本插件 = 与注册表自身的 persona 注册同名冲突，当场 fail loud
 *   —— **要"所有模式都生效"请改用本仓的全局入口** {@link ./global.js}（自有段名，不撞官方槽位）。
 *
 * 多宿主改造（2026-09-18）：渲染逻辑全部下沉到仓库根 core/（与 ZCode 适配器共享唯一源），
 * 段落注册下沉到 ./sections.js（与 global.js 共享唯一源），本文件只剩「选哪套段名」。
 *
 * 生效时机：段是装配期注册、text 是每步求值 —— 改配置下一步生效，改挂载要新会话。
 */
import { registerPersonaSections, PRESET_SECTIONS } from './sections.js'
import { registerReflex } from './reflex/index.js'

export const name = 'whale-persona'

/** 依赖 dsh-system-prompt 提供的 systemPrompt 服务 */
export const inject = ['systemPrompt']

export function apply(ctx) {
  // 条件反射层（reflex，2026-09-20 并入本插件）：默认**零规则** = 零行为改变；
  // 它自己挂 agent/pre-step（命中即注入）与 agent/request（那一步可选瘦身），与段落注册互不依赖。
  // 任何异常都只让这一层不生效，绝不影响人设段的装配（registerReflex 内部全 try/catch）。
  try { registerReflex(ctx) } catch { /* 反射层坏了也要把人设装上 */ }
  return registerPersonaSections(ctx, PRESET_SECTIONS)
}
