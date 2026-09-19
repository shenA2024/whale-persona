// 安装契约冒烟（0.11.1）：包必须能被 dsh 当成 profile 层自动挂载
// 触发来源：2026-09-19 实测 dsh plugin add 后只躺进 dependencies、不打补丁 —— 用户装完不生效。
// 判据：dsh.bundle.patch 声明存在、指向的文件存在、该补丁挂的是设置面板（人设本体走 agent preset，故意不在这层）。
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const t = (name, ok) => {
  console.log(name + ':', ok)
  if (!ok) process.exitCode = 1
}

const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const rel = pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch
t('I1 声明 dsh.bundle.patch:', typeof rel === 'string' && rel.length > 0)
t('I1 指向的文件存在:', !!rel && existsSync(path.join(ROOT, rel)))
t('I1 patch 被 files 白名单收进包里:', Array.isArray(pkg.files) && pkg.files.some((f) => String(f).includes('cordis.patch.yml')))

const patch = rel && existsSync(path.join(ROOT, rel)) ? readFileSync(path.join(ROOT, rel), 'utf8') : ''
t('I2 补丁挂设置面板:', /name:\s*'@shenA2024\/whale-persona-ui'/.test(patch))
t('I2 补丁**不**挂人设本体到 profile 层（口径：鲸鱼模式专属）:', !/name:\s*'@shenA2024\/whale-persona'\s*$/.test(patch.replace(/\r/g, '')))
t('I3 包入口与 global 入口都还在:', !!pkg.exports['.'] && !!pkg.exports['./global'])
t('I3 零运行时依赖（决定 Release tarball 能否独立安装）:', !pkg.dependencies && !pkg.devDependencies)
