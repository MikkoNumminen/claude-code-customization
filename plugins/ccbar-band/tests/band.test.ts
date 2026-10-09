import { describe, expect, test } from 'claude-code/testing'
import type { On, ProcessRunResult, RenderElement, SessionUsage } from 'claude-code'

import { shortModel } from '../hooks/register.tsx'

const SURFACES = ['terminal', 'desktop'] as const

const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 160,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
}

const FIVE_HOUR_RESET = '2026-10-09T14:05:00.000Z'
const SEVEN_DAY_RESET = '2026-10-12T07:30:00.000Z'

const EMPTY: SessionUsage = { startedAt: 0, context: { window: 200000 }, rateLimits: [] }

function figures(session: number, weekly: number, context: number): SessionUsage {
  return {
    startedAt: 0,
    context: { window: 200000, tokens: context * 2000, percent: context },
    rateLimits: [
      { kind: 'five_hour', percentUsed: session, resetsAt: FIVE_HOUR_RESET },
      { kind: 'seven_day', percentUsed: weekly, resetsAt: SEVEN_DAY_RESET },
    ],
  }
}

const ran = (exitCode: number, stdout: string): ProcessRunResult => ({
  exitCode,
  stdout,
  stderr: '',
  isStdoutTruncated: false,
  isStderrTruncated: false,
})

/*
 * The engine beneath the plugin: what the session reports, one git that
 * answers a branch, and an engine band that draws a marker the test can see,
 * so "the plugin yielded" is something to find rather than an absence.
 */
function world(on: On, start: SessionUsage, git: ProcessRunResult = ran(0, 'main\n')) {
  const seen = { usage: start, git, runs: [] as { argv: readonly string[]; cwd: string | undefined }[] }
  on('session.usage', () => ({ value: seen.usage }))
  on('session.model', () => ({ value: 'claude-fable-5-1' }))
  on('session.root', () => ({ value: 'C:/work/repo' }))
  on('process.run', ($, e) => {
    seen.runs.push({ argv: e.argv, cwd: e.init?.cwd })
    return { value: seen.git }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('ui.render', { component: 'AbovePrompt' }, () => h('Text', null, 'engine band') as RenderElement)
  return seen
}

const START = { cwd: 'C:/work/repo', surface: 'terminal', isInteractive: true } as const

const two = (n: number) => String(n).padStart(2, '0')
const local = (iso: string) => {
  const d = new Date(iso)
  return `${two(d.getHours())}:${two(d.getMinutes())}`
}
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/*
 * Only a Box keeps its key in a drawing, so the band is found by its Box and
 * its parts by what they show: the three percentages are the Texts that
 * hold nothing but a number and a percent sign, session, weekly, context.
 */
type Found = { text: string; props: Record<string, unknown> }
type Drawing = {
  find: (q: { key?: string; type?: string; text?: string | RegExp }) => Promise<Found | undefined>
  findAll: (q: { type?: string; text?: string | RegExp }) => Promise<Found[]>
}
const band = (ui: Drawing) => ui.find({ key: 'band' })
const engine = (ui: Drawing) => ui.find({ type: 'Text', text: 'engine band' })
const gauges = async (ui: Drawing) => {
  const found = await ui.findAll({ type: 'Text', text: /^\d+%$/ })
  return found.map(g => ({ text: g.text, color: g.props.color }))
}

describe('ccbar-band', () => {
  test('draws model, both limits with their resets, context and branch, in order', async ($, on) => {
    const seen = world(on, figures(23.4, 41, 12))
    await $.session.start(START)

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'ccbar-band', surface, component: 'AbovePrompt', props: PROPS })
      const row = await band(ui)
      expect(row).toBeDefined()
      const week = new Date(SEVEN_DAY_RESET)
      expect(row!.text).toBe(
        `Fable 5.1 │ Session 23% ${local(FIVE_HOUR_RESET)} │ ` +
          `Weekly 41% ${DAYS[week.getDay()]} ${local(SEVEN_DAY_RESET)} │ Context 12% │ main`,
      )
      expect(await engine(ui)).toBeUndefined()
      await ui.unmount()
    }

    // one git process, in the session root, that exits
    expect(seen.runs).toEqual([{ argv: ['git', 'symbolic-ref', '--short', '-q', 'HEAD'], cwd: 'C:/work/repo' }])
  })

  test('colours each percentage at 70 and at 90, on the number shown', async ($, on) => {
    const seen = world(on, figures(69.4, 70, 89))
    await $.session.start(START)
    const ui = await $.ui.mount({ plugin: 'ccbar-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS })

    expect(await gauges(ui)).toEqual([
      { text: '69%', color: undefined },
      { text: '70%', color: 'warning' },
      { text: '89%', color: 'warning' },
    ])

    seen.usage = figures(69.5, 90, 100)
    await $.session.measure({ ...seen.usage, changed: ['rateLimits', 'context'] })

    expect(await gauges(ui)).toEqual([
      { text: '70%', color: 'warning' },
      { text: '90%', color: 'error' },
      { text: '100%', color: 'error' },
    ])
  })

  test('shows nothing before the first measurement, then the figures it brings', async ($, on) => {
    const seen = world(on, EMPTY)
    await $.session.start(START)
    const ui = await $.ui.mount({ plugin: 'ccbar-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS })

    expect(await band(ui)).toBeUndefined()
    expect(await engine(ui)).toBeDefined()

    seen.usage = figures(5, 6, 7)
    await $.session.measure({ ...seen.usage, changed: ['rateLimits', 'context'] })

    expect((await gauges(ui)).map(g => g.text)).toEqual(['5%', '6%', '7%'])
    expect(await engine(ui)).toBeUndefined()

    // an empty reading later never blanks figures already shown
    seen.usage = EMPTY
    await $.session.measure({ ...EMPTY, changed: ['context'] })
    expect((await gauges(ui)).map(g => g.text)).toEqual(['5%', '6%', '7%'])
  })

  test('yields the band to a survey', async ($, on) => {
    world(on, figures(50, 50, 50))
    await $.session.start(START)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({
        plugin: 'ccbar-band',
        surface,
        component: 'AbovePrompt',
        props: { ...PROPS, hasSurvey: true },
      })
      expect(await band(ui)).toBeUndefined()
      expect(await engine(ui)).toBeDefined()
      await ui.unmount()
    }
  })

  test('reads the branch again when a turn completes, detached included', async ($, on) => {
    const seen = world(on, figures(1, 2, 3))
    await $.session.start(START)
    const ui = await $.ui.mount({ plugin: 'ccbar-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
    expect((await band(ui))!.text.endsWith('Context 3% │ main')).toBe(true)

    // the turn checked out something else and left HEAD detached
    seen.git = ran(1, '')
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

    expect((await band(ui))!.text.endsWith('Context 3% │ detached')).toBe(true)
    expect(seen.runs).toHaveLength(2)
  })

  test('leaves the branch out outside a repository', async ($, on) => {
    world(on, figures(1, 2, 3), ran(128, ''))
    await $.session.start(START)
    const ui = await $.ui.mount({ plugin: 'ccbar-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
    expect((await band(ui))!.text.endsWith('Context 3%')).toBe(true)
  })

  test('names models by family and version', () => {
    expect(shortModel('claude-fable-5-1')).toBe('Fable 5.1')
    expect(shortModel('claude-opus-5-5[1m]')).toBe('Opus 5.5')
    expect(shortModel('claude-opus-4-5-20251101')).toBe('Opus 4.5')
    expect(shortModel('claude-sonnet-4-20250514')).toBe('Sonnet 4')
    expect(shortModel('claude-3-5-sonnet-20241022')).toBe('Sonnet 3.5')
    expect(shortModel('Opus 5.5 (1M context)')).toBe('Opus 5.5')
    expect(shortModel('haiku')).toBe('Haiku')
    expect(shortModel('some-gateway-model')).toBe('some-gateway-model')
  })
})
