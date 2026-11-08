import fs from "node:fs"
const file = "C:/Users/Administrator/repos/dshx/scratch/grok-test.mjs"
let s = fs.readFileSync(file, "utf8")
const once = (a, b, label) => { const n = s.split(a).length - 1; if (n !== 1) throw new Error(label + ": " + n); s = s.replace(a, b); console.log("ok:", label) }

// the stub now answers the real billing payload plus the subscription tier
once(
`  if (target.includes('/billing')) {
    return new Response(JSON.stringify({ config: { planName: 'SuperGrok', monthlyLimit: 150, used: 45, billingPeriodEnd: '2026-12-01T00:00:00Z' } }), { status: 200 })
  }`,
`  if (target.includes('/billing')) {
    return new Response(JSON.stringify({
      config: {
        currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-11-03T15:54:34Z', end: '2026-11-10T15:54:34Z' },
        creditUsagePercent: 5,
        productUsage: [{ product: 'GrokImagine', usagePercent: 4 }, { product: 'GrokChat', usagePercent: 1 }],
        prepaidBalance: { val: 0 },
        billingPeriodEnd: '2026-11-10T15:54:34Z',
      },
    }), { status: 200 })
  }
  if (target.includes('/user?include=subscription')) {
    return new Response(JSON.stringify({ email: 'grok@example.com', subscriptionTier: 'GrokPro' }), { status: 200 })
  }`,
  "billing stub",
)

// assertions follow the real shape: a weekly window, not dollars
once(
`  assert.equal(entry.meters[0].percent, 30, '45 of 150 credits is 30%')
  assert.equal(entry.meters[0].limitUSD, 150)
  const fields = Object.fromEntries(entry.fields.map((field) => [field.key, field.value]))
  assert.equal(fields.plan, 'SuperGrok')`,
`  assert.equal(entry.meters[0].id, 'weekly', 'the Build plan meters a rolling weekly window')
  assert.equal(entry.meters[0].percent, 5, 'the upstream percentage is shown as-is')
  assert.equal(entry.meters[0].resetsAt, '2026-11-10T15:54:34Z')
  const fields = Object.fromEntries(entry.fields.map((field) => [field.key, field.value]))
  assert.equal(fields.plan, 'GrokPro', 'the subscription tier names the plan')
  assert.equal(fields.weeklyReset, '2026-11-10T15:54:34Z', 'the reset time is labelled as the weekly reset')`,
  "billing assertions",
)

fs.writeFileSync(file, s)
