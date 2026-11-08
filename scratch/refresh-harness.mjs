// Refresh the import-rewritten copy of plugin/index.js used by the scratch harnesses.
import fs from 'node:fs'

const SRC = 'C:/Users/Administrator/repos/dshx/plugin/index.js'
const COPY = 'C:/Users/Administrator/repos/dshx/scratch/index.testable.mjs'
const SCHEMASTERY = 'file:///C:/Users/Administrator/repos/dshx/asar/dsh/node_modules/@deepseek-ai/schemastery/lib/index.mjs'

let source = fs.readFileSync(SRC, 'utf8')
if (!source.includes("from '@deepseek-ai/schemastery'")) throw new Error('schemastery import not found')
source = source.replace("from '@deepseek-ai/schemastery'", `from '${SCHEMASTERY}'`)
source = source.replace("from './grok.js'", "from 'file:///C:/Users/Administrator/repos/dshx/plugin/grok.js'")
fs.writeFileSync(COPY, source)
console.log('rewrote', COPY)
