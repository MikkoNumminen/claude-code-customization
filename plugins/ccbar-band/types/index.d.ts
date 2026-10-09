/** One rate-limit window as the band shows it: whole percent and its reset. */
export type BandLimit = { percent: number; resetsAt: string | null }

/**
 * The figures of the last reading that had any. `null` fields are figures
 * the engine did not report (no subscription, no response yet).
 */
export type BandReading = {
  session: BandLimit | null
  weekly: BandLimit | null
  context: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'ccbar-band': {
      /** null until the first reading with a figure in it: the band hides */
      reading: BandReading | null
      /** the model as the band names it, "Fable 5.1" */
      model: string | null
      /** the session root's branch, "detached", or null outside a repo */
      branch: string | null
    }
  }
}
