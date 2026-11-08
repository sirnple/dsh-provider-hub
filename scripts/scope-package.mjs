// Publish name: `dsh-provider-hub` is owned by another author on npm, so the
// package moves to the scope while the GitHub repo and the settings row id stay.
import fs from 'node:fs'

const PLUGIN = 'C:/Users/Administrator/repos/dsh-provider-hub/plugin'
const done = []
function patch(file, search, replacement, label) {
  let source = fs.readFileSync(file, 'utf8')
  const count = source.split(search).length - 1
  if (count !== 1) throw new Error(`${label}: expected 1, found ${count}`)
  fs.writeFileSync(file, source.replace(search, replacement))
  done.push(label)
}

// 1. package.json: name, publishing metadata, raster icon, assets in the tarball.
const pkgPath = `${PLUGIN}/package.json`
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
pkg.name = '@sirnple/dsh-provider-hub'
pkg.version = '1.0.0'
pkg.description = 'Model provider and account hub for DeepSeek Harness: multi-account API keys per provider with failover, a per-account usage/quota panel in the conversation header, and native Grok Build device-code OAuth.'
pkg.license = 'MIT'
pkg.author = 'sirnple'
pkg.homepage = 'https://github.com/sirnple/dsh-provider-hub#readme'
pkg.repository = { type: 'git', url: 'git+https://github.com/sirnple/dsh-provider-hub.git', directory: 'plugin' }
pkg.bugs = { url: 'https://github.com/sirnple/dsh-provider-hub/issues' }
pkg.keywords = ['dsh-plugin', 'deepseek-harness', 'dsh', 'provider', 'accounts', 'usage', 'oauth', 'grok']
pkg.icon = './assets/icon-180.png'
pkg.publishConfig = { access: 'public' }
pkg.engines = { dsh: '>=0.2.1-rc.1' }
if (!pkg.files.includes('assets/icon-180.png')) pkg.files.push('assets/icon-180.png')
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
done.push('package.json')

// 2. the bundle row names the package.
patch(`${PLUGIN}/cordis.patch.yml`, 'name: dsh-provider-hub', 'name: "@sirnple/dsh-provider-hub"', 'cordis row name')

// 3. the client module id follows the package name.
patch(`${PLUGIN}/client.js`, "id: 'dsh-provider-hub',", "id: '@sirnple/dsh-provider-hub',", 'client module id')
patch(`${PLUGIN}/client.js`, "const CSS_TAG_ID = 'dsh-provider-hub/client.css'", "const CSS_TAG_ID = '@sirnple/dsh-provider-hub/client.css'", 'css tag id')
patch(`${PLUGIN}/client.js`, "tag.dataset.plugin = 'dsh-provider-hub'", "tag.dataset.plugin = '@sirnple/dsh-provider-hub'", 'css tag dataset')

console.log(`patched ${done.length}: ${done.join(', ')}`)
