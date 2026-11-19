/**
 * Browser half: locale-exact reasoning-effort names.
 *
 * WHY THIS EXISTS. The Host half (see `index.js`) serves Chinese effort names
 * to every consumer, which is right for a consumer with no locale of its own
 * but wrong for the Web GUI, which knows its own language and must show
 * English in English.
 *
 * WHY IT SURVIVES AN UPGRADE. The browser half re-maps every advertised
 * effort by its id — the one value every adapter agrees on — instead of
 * trusting the incoming name. The mapping is derived from the id alone, so a
 * renamed or extended adapter stays readable: an id this table does not know
 * keeps whatever name it arrived with.
 *
 * It also corrects the one row whose text is not an effort name: the selector's
 * "provider default" row, whose Chinese dictionary entry is still English. A
 * locale namespace has exactly one owner, so a second `register()` for the same
 * namespace and locale is refused; the dictionary a live locale service holds
 * is therefore corrected in place. If a future release renames that key, the
 * correction simply stops matching and the row falls back to the shipped
 * wording instead of breaking.
 */
window.__ModuleLoader__.load({
  id: 'dsh-llm-effort-zh',
  factory(require) {
    /**
     * Chinese display names, keyed by the effort id.
     *
     * @type {Record<string, string>}
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

    /**
     * The English display name for an effort id: the id capitalized, which is
     * exactly what the shipped adapters name their levels.
     *
     * @param {string} id - The effort's opaque id.
     * @returns {string} The English name.
     */
    const nameEn = id => `${id.charAt(0).toUpperCase()}${id.slice(1)}`

    /**
     * The display name for an effort in one language.
     *
     * @param {string} id - The effort's opaque id.
     * @param {string} fallback - The name the catalog carried.
     * @param {string} locale - The active locale id.
     * @returns {string} The localized name.
     */
    const nameFor = (id, fallback, locale) => {
      if (locale === 'zh') {
        const mapped = NAMES_ZH[id]
        return typeof mapped === 'string' ? mapped : fallback
      }
      return nameEn(id)
    }

    /**
     * Re-map every effort name in one model catalog.
     *
     * @param {unknown} catalog - The catalog the Host returned.
     * @param {string} locale - The active locale id.
     * @returns The catalog with localized effort names.
     */
    const localizeCatalog = (catalog, locale) => {
      if (catalog === null || typeof catalog !== 'object') return catalog
      const groups = catalog.groups
      if (!Array.isArray(groups)) return catalog
      return {
        ...catalog,
        groups: groups.map(group => ({
          ...group,
          models: group.models.map(model => {
            if (model.reasoning === undefined) return model
            return {
              ...model,
              reasoning: {
                ...model.reasoning,
                efforts: model.reasoning.efforts.map(effort => ({
                  ...effort,
                  name: nameFor(effort.id, effort.name, locale),
                })),
              },
            }
          }),
        })),
      }
    }

    return {
      inject: ['locale', 'remote.session'],
      apply(ctx) {
        const locale = ctx.get('locale')
        const session = ctx.get('remote.session')
        if (locale === undefined || session === undefined) return

        /**
         * The locale namespace and key the shipped model-selection plugin uses.
         */
        const NAMESPACE = 'model'
        const KEY = 'effort.providerDefault'
        const LOCALE = 'zh'
        const TEXT = '默认'

        /**
         * Correct the Chinese dictionary for the one key this plugin owns.
         * @returns whether the dictionary was corrected.
         */
        const correctDefaultRow = () => {
          // The dictionary map is an implementation detail of the locale
          // service; the key it holds is the stable part.
          const namespaces = locale.dicts
          if (!(namespaces instanceof Map)) return false
          const locales = namespaces.get(NAMESPACE)
          if (!(locales instanceof Map)) return false
          // Locale ids are normalized to lower case by the locale service.
          const zh = locales.get(LOCALE)
          if (zh === undefined || typeof zh !== 'object') return false
          if (zh[KEY] === TEXT) return true
          zh[KEY] = TEXT
          return true
        }

        // The namespace may not be registered yet at boot, so every publish
        // (a registration or a language switch) is one chance to correct it.
        ctx.effect(() => locale.subscribe(() => { correctDefaultRow() }), 'llm-effort-zh: correct default row')
        correctDefaultRow()

        /**
         * The catalog call as the namespace service currently offers it.
         *
         * The namespace service defines each method as an own accessor whose
         * getter returns the calling function, so reading the property is what
         * yields the callable — not `descriptor.value`.
         *
         * @returns {(() => unknown) | undefined} The callable, if present.
         */
        const catalogCall = () => {
          const current = session.modelCatalog
          return typeof current === 'function' ? current : undefined
        }

        /**
         * Wrap the catalog call so the names it carries match the active
         * language.
         *
         * @returns whether the wrapper is installed.
         */
        const patchCatalog = () => {
          const original = catalogCall()
          if (original === undefined) return false
          if (original[Symbol.for('dsh.llm-effort-zh')] === true) return true

          const patched = async (...args) => {
            const response = await original(...args)
            if (response === null || typeof response !== 'object') return response
            if (response.ok !== true) return response
            return { ...response, value: localizeCatalog(response.value, locale.getSnapshot().active) }
          }
          Object.defineProperty(patched, Symbol.for('dsh.llm-effort-zh'), { value: true })

          // The accessor is configurable, so a plain own value replaces it.
          Object.defineProperty(session, 'modelCatalog', {
            configurable: true,
            enumerable: true,
            writable: true,
            value: patched,
          })
          return true
        }

        if (!patchCatalog()) {
          // The accessor is defined when the namespace mounts; a later publish
          // is the next chance to wrap it.
          ctx.effect(() => locale.subscribe(() => { patchCatalog() }), 'llm-effort-zh: wrap catalog')
        }
      },
    }
  },
})
