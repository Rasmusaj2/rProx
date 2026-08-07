#!/usr/bin/env node
'use strict'

// claude generated script to cut down on .exe build size
// removes minecraft-data for versions that dont fit the needed 1.8.x protocol, and replaces JSON requires with paths to the files

// minecraft-data's generated data.js statically requires every JSON file for
// every version of both editions (~2400 requires, 375 MB). pkg follows static
// requires, so all of it lands in the exe. rProx only ever talks 1.8.x, so we
// regenerate data.js from dataPaths.json with everything else stripped out.
//
// Runs before `pkg`; idempotent, and safe to re-run after `npm install`.

const fs = require('fs')
const path = require('path')

// Major-version keys to keep, as they appear in dataPaths.json.
// 1.7 stays for the pre-netty legacy ping path and 1.8's mapIcons reference.
const KEEP = {
  pc: ['1.7', '1.8'],
  bedrock: []
}

const root = path.join(__dirname, '..', 'node_modules', 'minecraft-data')
const dataSource = require(path.join(root, 'minecraft-data', 'data', 'dataPaths.json'))

const out = 'module.exports =\n{\n' + Object
  .keys(dataSource)
  .map(edition => {
    const keep = KEEP[edition] || []
    return "  '" + edition + "': {\n" + Object
      .keys(dataSource[edition])
      .filter(version => keep.includes(version))
      .map(version =>
        "    '" + version + "': {" + '\n' + Object
          .keys(dataSource[edition][version])
          .map(key => {
            const loc = `minecraft-data/data/${dataSource[edition][version][key]}/`
            if (fs.existsSync(path.join(root, loc, key + '.json'))) {
              return `      get ${key} () { return require("./${loc}${key}.json") }`
            }
            const file = fs.readdirSync(path.join(root, loc)).find(f => f.startsWith(key + '.'))
            if (!file) throw new Error('file not found: ' + loc + key)
            return `      ${key}: __dirname + '/${loc}${file}'`
          })
          .join(',\n') +
        '\n    }'
      )
      .join(',\n') +
      '\n  }'
  })
  .join(',\n') + '\n}\n'

const target = path.join(root, 'data.js')
const before = fs.statSync(target).size
fs.writeFileSync(target, out)

const kept = Object.entries(KEEP).map(([e, v]) => `${e}: ${v.join(', ') || 'none'}`).join(' | ')
console.log(`pruned minecraft-data/data.js  ${(before / 1024).toFixed(0)} KB -> ${(out.length / 1024).toFixed(0)} KB  (${kept})`)
