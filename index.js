/**
 * dsh-workspace-fix — host half.
 *
 * The actual fix is the bundle patch beside this file: it disables the
 * adaptive `@deepseek-ai/dsh-host-directory-picker-auto` row and composes
 * `@deepseek-ai/dsh-host-directory-picker-browse` together with its client
 * surface `@deepseek-ai/dsh-client-ui-directory-picker-browse`.
 *
 * This module exists so the pin is observable at runtime: it reports the
 * resolved directory-picker capability in the host log, which is how you
 * confirm the change hot-applied to a running `dsh web` without a restart.
 *
 * Loaded through the profile's own patch layer, so it stays dependency-free:
 * no imports, no build step, plain ESM.
 */

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-workspace-fix'

/**
 * Report which directory-picker backend is actually mounted.
 *
 * `ctx.inject` keeps this honest across row ordering and hot reloads: the
 * callback runs as soon as the picker service exists and re-runs whenever it
 * is replaced, so the log always names the backend that is live right now.
 * The sibling browse backend row may mount before or after this row, so an
 * eager read would race; injection does not.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - host plugin context.
 */
export function apply(ctx) {
  ctx.inject(['directoryPicker'], (scope) => {
    const kind = scope.directoryPicker?.capability?.().kind ?? 'unknown'
    const line = `[dsh-workspace-fix] in-browser directory picker pinned; resolved backend = ${kind}`
    if (kind === 'browse') {
      scope.logger?.info?.(line)
      console.log(line)
    } else {
      // Anything other than `browse` means the native OS chooser is still
      // serving picks and the pin did not take effect.
      scope.logger?.warn?.(line)
      console.warn(line)
    }
  })
}
