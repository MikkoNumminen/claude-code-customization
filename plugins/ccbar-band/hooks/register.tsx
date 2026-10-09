import { atom, read, update } from 'claude-code'
import type { Color, EngineInterface, Register, SessionRateLimit, SessionUsage } from 'claude-code'

import type { BandLimit, BandReading } from '../types'

/*
 * ccbar's figures in the band above the prompt. The engine places the band,
 * so it survives a resize, a /clear and an update the way the old top-edge
 * bar, drawn by a second process into a split of the terminal, never could.
 *
 * Nothing here runs on a timer. The figures arrive pushed: once when the
 * session starts and again each time the engine raises session.measure. The
 * branch is read once per turn, by one short git process that exits.
 */

const reading = atom({ plugin: 'ccbar-band', key: 'reading' } as const, null)
const model = atom({ plugin: 'ccbar-band', key: 'model' } as const, null)
const branch = atom({ plugin: 'ccbar-band', key: 'branch' } as const, null)

const FAMILIES = ['fable', 'opus', 'sonnet', 'haiku']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/*
 * "claude-fable-5-1", "claude-opus-4-5-20251101", "claude-3-5-sonnet-20241022",
 * "Opus 5.5 (1M context)" and "opus" all come back as family and version. A
 * version part is one or two digits, so a date stamp is never read as one.
 */
export function shortModel(raw: string): string {
  const s = raw.toLowerCase()
  const family = FAMILIES.find(f => s.includes(f))
  if (family === undefined) return raw.trim()
  const name = family[0]!.toUpperCase() + family.slice(1)
  const after = s.match(new RegExp(family + '[-\\s]*(\\d{1,2})(?![\\d])(?:[-.](\\d{1,2})(?![\\d]))?'))
  const before = s.match(new RegExp('(\\d{1,2})[-.](\\d{1,2})[-\\s]*' + family))
  const m = after ?? before
  if (m === null) return name
  return m[2] === undefined ? `${name} ${m[1]}` : `${name} ${m[1]}.${m[2]}`
}

/** Default under 70, warning from 70, error from 90: on the shown number. */
export function tone(percent: number): Color | undefined {
  if (percent >= 90) return 'error'
  if (percent >= 70) return 'warning'
  return undefined
}

const two = (n: number) => String(n).padStart(2, '0')

function when(iso: string | null): Date | null {
  if (iso === null) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

/** HH:MM, local. */
export function clock(iso: string | null): string | null {
  const d = when(iso)
  return d && `${two(d.getHours())}:${two(d.getMinutes())}`
}

/** Day and HH:MM, local: "Mon 09:00". */
export function dayClock(iso: string | null): string | null {
  const d = when(iso)
  return d && `${DAYS[d.getDay()]} ${two(d.getHours())}:${two(d.getMinutes())}`
}

function limit(windows: SessionRateLimit[], kind: string): BandLimit | null {
  const w = windows.find(x => x.kind === kind)
  return w ? { percent: Math.round(w.percentUsed), resetsAt: w.resetsAt ?? null } : null
}

/** The figures, or null while the engine has none to give. */
export function toReading(usage: SessionUsage): BandReading | null {
  const session = limit(usage.rateLimits, 'five_hour')
  const weekly = limit(usage.rateLimits, 'seven_day')
  const percent = usage.context.percent
  const context = percent === undefined ? null : Math.round(percent)
  if (session === null && weekly === null && context === null) return null
  return { session, weekly, context }
}

async function measure($: EngineInterface) {
  const [usage, name] = await Promise.all([$.session.usage(), $.session.model()])
  const next = toReading(usage)
  // a reading with nothing in it never takes the place of one that had figures
  if (next !== null) await update($, reading, () => next)
  await update($, model, () => shortModel(name))
}

/*
 * One git process that exits: symbolic-ref answers the branch (an unborn one
 * too) with 0, a detached HEAD with 1, anything that is no repository with
 * 128. A git that is missing or hangs leaves the band without a branch.
 */
async function readBranch($: EngineInterface) {
  let name: string | null = null
  try {
    const cwd = await $.session.root()
    const r = await $.process.run(['git', 'symbolic-ref', '--short', '-q', 'HEAD'], { cwd, timeoutMs: 5000 })
    if (r.exitCode === 0) name = r.stdout.trim() || null
    else if (r.exitCode === 1) name = 'detached'
  } catch {
    name = null
  }
  await update($, branch, () => name)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await Promise.all([measure($), readBranch($)])
    return result
  })

  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    await measure($)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await readBranch($)
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const r = await read($, reading)
    if (r === null) return next(e)
    const [name, head] = await Promise.all([read($, model), read($, branch)])

    const { Box, Text } = $.ui.resolve(e)

    // a colour only from 70: under it the number takes the band's own
    const gauge = (percent: number) => {
      const color = tone(percent)
      return color === undefined ? <Text>{percent}%</Text> : <Text color={color}>{percent}%</Text>
    }
    const reset = (at: string | null) => (at === null ? '' : <Text dimColor> {at}</Text>)

    const parts = []
    if (name !== null) parts.push(<Text>{name}</Text>)
    if (r.session !== null) {
      parts.push(
        <Text>
          Session {gauge(r.session.percent)}
          {reset(clock(r.session.resetsAt))}
        </Text>,
      )
    }
    if (r.weekly !== null) {
      parts.push(
        <Text>
          Weekly {gauge(r.weekly.percent)}
          {reset(dayClock(r.weekly.resetsAt))}
        </Text>,
      )
    }
    if (r.context !== null) parts.push(<Text>Context {gauge(r.context)}</Text>)
    if (head !== null) parts.push(<Text>{head}</Text>)

    const row = []
    for (const [i, part] of parts.entries()) {
      if (i > 0) row.push(<Text dimColor> │ </Text>)
      row.push(part)
    }

    return (
      <Box key="band" width={e.props.bodyColumns}>
        <Text wrap="truncate-end">{row}</Text>
      </Box>
    )
  })
}
