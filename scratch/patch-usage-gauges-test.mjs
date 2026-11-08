// Extend the Host usage harness with the structured gauge assertions.
import fs from 'node:fs'

const FILE = 'C:/Users/Administrator/repos/dshx/scratch/usage-test.mjs'
let source = fs.readFileSync(FILE, 'utf8')
const MARKER = `    assert.equal(fields.weeklyReset, '2026-10-27T00:00:00.000Z')`
if (source.includes('gauge fiveHour')) {
  console.log('already patched')
  process.exit(0)
}
if (!source.includes(MARKER)) throw new Error('anchor not found')

source = source.replace(MARKER, `${MARKER}
    // Structured gauges: the page draws these as progress bars.
    assert.ok(Array.isArray(balance.meters), 'balance carries structured meters')
    const gauge = Object.fromEntries(balance.meters.map((meter) => [meter.id, meter]))
    assert.deepEqual(Object.keys(gauge).sort(), ['fiveHour', 'monthly', 'weekly'])
    assert.equal(gauge.fiveHour.percent, 0, 'gauge fiveHour percent')
    assert.equal(gauge.weekly.percent, 12.5, 'gauge weekly percent')
    assert.equal(gauge.monthly.percent, 100, 'gauge monthly percent')
    assert.equal(gauge.monthly.status, 'rate-limited', 'gauge monthly status')
    assert.equal(gauge.weekly.resetsAt, '2026-10-27T00:00:00.000Z', 'gauge weekly reset')
    assert.equal(gauge.fiveHour.usedUSD, 0, 'gauge fiveHour used dollars')
    assert.equal(gauge.fiveHour.limitUSD, 12, 'gauge fiveHour limit dollars')
    assert.equal(gauge.weekly.limitUSD, 30, 'gauge weekly limit dollars')
    assert.equal(gauge.monthly.limitUSD, 60, 'gauge monthly limit dollars')`)

fs.writeFileSync(FILE, source)
console.log('patched usage harness with gauge assertions')
