/**
 * Reasoning-effort names in Chinese, without touching the wire values.
 *
 * WHY THIS EXISTS. An adapter advertises each selectable reasoning level with
 * a display `name` next to an opaque `id`. The `id` is what dispatch sends, so it
 * must stay exactly as the provider spells it; the `name` is the only
 * user-facing part, and it is hardcoded in English by every shipped adapter.
 *
 * WHY IT SURVIVES AN UPGRADE. This bundle lives in the profile's
 * `node_modules`, not inside the application's bundle, and it only uses the
 * published `ctx.llm` service contract: `resolveModelInfo()` returns a
 * detached `LlmResolvedModelInfo` whose `reasoning.efforts[].name` is a free
 * display string. Rewriting that string here changes what every selector shows
 * without touching a single byte of an outgoing request.
 *
 * SCOPE. This Host half is the locale-blind fallback: it always serves the
 * Chinese names, which is what a consumer with no locale of its own needs (the
 * ACP bridge, for one). The browser half owns the Web GUI's own locale and
 * re-maps every effort by its id, so the GUI shows Chinese in Chinese and
 * English in English.
 *
 * @module dsh-llm-effort-zh
 */

/** The service this plugin decorates. */
export const inject = ['llm']

/**
 * Chinese display names for the reasoning levels DSH's adapters speak, keyed by
 * the level id (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`).
 *
 * An id absent from this table keeps the adapter's own name: a provider that
 * invents a level DSH does not know about stays readable rather than blank.
 */
const NAMES_ZH = {
  off: '关闭',
  minimal: '极简',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最大',
}

/** Chinese descriptions for the levels that ship one. */
const DESCRIPTIONS_ZH = {
  off: '用于不需要推理的简单任务。',
  minimal: '最低限度推理，适合极简单或极短的任务。',
  low: '适合常规任务或对延迟敏感的任务。',
  medium: '在质量与速度之间取得平衡。',
  high: '多数任务的默认平衡点。',
  xhigh: '面向复杂、以质量为重的任务。',
  max: '留给最难的、以质量为重的任务。',
}

/**
 * The display name for one effort, in the adapter's own words when this table
 * does not name the level.
 *
 * @param id - The effort's opaque id.
 * @param name - The adapter's own display name.
 * @returns The Chinese name, or the original when the level is unknown here.
 */
function chineseName(id, name) {
  const mapped = NAMES_ZH[id]
  return typeof mapped === 'string' ? mapped : name
}

/**
 * The description for one effort, when this table describes the level.
 *
 * @param id - The effort's opaque id.
 * @param description - The adapter's own description.
 * @returns The Chinese description, or the original when none applies.
 */
function chineseDescription(id, description) {
  const mapped = DESCRIPTIONS_ZH[id]
  return typeof mapped === 'string' ? mapped : description
}

/**
 * Rewrite one resolved model info's reasoning metadata for display.
 *
 * The `id` of every effort is left untouched: it is the value dispatch sends to
 * the provider, and a localized id would change the request itself.
 *
 * @param info - The adapter-resolved model info.
 * @returns The same info with localized effort names.
 */
function localize(info) {
  const reasoning = info.reasoning
  if (reasoning === undefined) return info
  return {
    ...info,
    reasoning: {
      ...reasoning,
      efforts: reasoning.efforts.map(effort => ({
        ...effort,
        name: chineseName(effort.id, effort.name),
        ...effort.description === undefined
          ? {}
          : { description: chineseDescription(effort.id, effort.description) },
      })),
    },
  }
}

/**
 * Install the display-only rewrite on the `llm` service.
 *
 * The service object is a Cordis `Service` whose methods live on its prototype,
 * and the registry hands consumers a traceable proxy over it. Replacing the
 * prototype method therefore reaches every consumer, including the ones that
 * read the service through `ctx.llm` rather than through a captured reference.
 *
 * @param ctx - The plugin context, carrying the `llm` service.
 */
export function apply(ctx) {
  const llm = ctx.get('llm')
  if (llm === undefined) return

  const target = Object.getPrototypeOf(llm)
  const original = target.resolveModelInfo
  if (typeof original !== 'function') return

  const patched = function resolveModelInfo(provider, model, signal) {
    const pending = original.call(this, provider, model, signal)
    return Promise.resolve(pending).then(localize)
  }

  // Only patch once: a second application (a reloaded profile, a duplicated
  // bundle row) must not wrap the rewrite in another rewrite.
  if (original[Symbol.for('dsh.llm-effort-zh')] === true) return
  Object.defineProperty(patched, Symbol.for('dsh.llm-effort-zh'), { value: true })

  target.resolveModelInfo = patched
  ctx.effect(() => () => {
    if (target.resolveModelInfo === patched) target.resolveModelInfo = original
  }, 'llm-effort-zh: restore resolveModelInfo')
}
