// Bundle the pinned PDF.js runtime locally: the extension never loads remote code.
const fs = require('node:fs'), path = require('node:path')
const root = path.resolve(__dirname, '..')
const dependency = path.join(root, 'node_modules/pdfjs-dist')
const output = path.join(root, 'browser-extension/vendor/pdfjs')
fs.rmSync(output, { recursive: true, force: true })
fs.mkdirSync(output, { recursive: true })
for (const name of ['build/pdf.mjs', 'build/pdf.worker.mjs', 'web/pdf_viewer.css', 'cmaps', 'standard_fonts', 'wasm', 'iccs', 'LICENSE']) {
  fs.cpSync(path.join(dependency, name), path.join(output, name), { recursive: true })
}
fs.writeFileSync(path.join(output, 'VERSION'), require(path.join(dependency, 'package.json')).version + '\n')
console.log('EXTENSION_BUILD_OK PDF.js ' + require(path.join(dependency, 'package.json')).version)
