import alias from '@rollup/plugin-alias';
import {babel} from '@rollup/plugin-babel';
import commonjs from '@rollup/plugin-commonjs';
import {nodeResolve} from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';
import {Buffer} from 'buffer';
import deepmerge from 'deepmerge';
import fs from 'fs';
import * as path from 'path';
import copy from 'rollup-plugin-copy';
import css from 'rollup-plugin-css-only';

//#region Definitions

const BUILD = 'DEV';
// const BUILD = 'CHROME';
const IS_PROD = BUILD !== 'DEV';
const DST = 'dist/';
const ASSETS = 'assets';
const JS = 'js';
const SHIM = path.resolve('tools/shim') + '/';
const ENTRY_BG = 'background';
const ENTRIES = [
  'edit',
  ENTRY_BG,
];

//#endregion
//#region Plugins

const PLUGINS = [
  copyAndWatch([
    'manifest.json',
    '_locales',
    'css/icons.ttf',
    'images/eyedropper',
    'images/icon',
    'npm:less/dist/less.min.js -> less.js',
    'npm:stylus-lang-bundle/dist/stylus-renderer.min.js -> stylus-lang-bundle.js',
    'npm:stylelint-bundle/dist/stylelint-bundle.min.js -> stylelint-bundle.js',
  ]),
  commonjs(),
  nodeResolve(),
  alias({
    entries: [
      {find: /^\//, replacement: path.resolve('src') + '/'},
      {find: './fs-drive', replacement: SHIM + 'empty.js'},
      {find: 'fs', replacement: SHIM + 'empty.js'},
      {find: 'path', replacement: SHIM + 'path.js'},
      {find: 'url', replacement: SHIM + 'url.js'},
    ],
  }),
  babel({
    babelHelpers: 'bundled',
    presets: [
      ['@babel/preset-env', {
        useBuiltIns: false,
        bugfixes: true,
        loose: true,
      }],
    ],
  }),
];
const PLUGIN_TERSER = IS_PROD && terser({
  compress: {
    ecma: 8,
    passes: 2,
    reduce_funcs: false,
    unsafe_arrows: true,
  },
  output: {
    ascii_only: false,
    comments: false,
    wrap_func_args: false,
  },
});
const PLUGIN_CSS = css();

//#endregion
//#region Entry

function makeEntry(entry, file, opts) {
  const entryPrefix = entry ? entry + '-' : '';
  const entryCss = entry ? entry + '.css' : undefined;
  const entryFileName = `${entry || '[name]'}.js`;
  return deepmerge({
    input: {
      [entry || getFileName(file)]: file || `src/${entry}/index.js`,
    },
    output: {
      dir: DST + (entry ? ASSETS : JS),
      sourcemap: IS_PROD ? '' : 'inline',
      generatedCode: 'es2015',
      externalLiveBindings: false,
      freeze: false,
      intro: 'const ' +
        Object.entries({JS, BUILD, ENTRY: entry})
          .map(([k, v]) => v && `__${k} = '${v}'`).filter(Boolean).join(',') + ';',
      assetFileNames: entryCss,
      chunkFileNames: chunk => entryPrefix + getChunkName(chunk),
      entryFileNames: entryFileName,
    },
    plugins: [
      ...PLUGINS,
      entry && copyAndWatch([`${entry}.html`], {
        __ASSET_JS: entryFileName,
        __ASSET_CSS: entryCss,
      }),
      entry && entry !== ENTRY_BG && PLUGIN_CSS,
      PLUGIN_TERSER,
    ].filter(Boolean),
  }, opts || {});
}

function makeEntryIIFE(file, name, opts) {
  return makeEntry(undefined, file, deepmerge({
    output: {
      name,
      format: 'umd',
    },
  }, opts || {}));
}

//#endregion
//#region Util

function copyAndWatch(files, vars) {
  const rxVars = vars && new RegExp(`${Object.keys(vars).join('|')}`, 'g');
  const replacer = vars && (s => vars[s]);
  const npms = {};
  const transform = (buf, name) => {
    let str = buf.toString();
    if (vars) str = str.replace(rxVars, replacer);
    if (name.endsWith('.js')) {
      const map = npms[name] + '.map';
      str = str.replace(/(\r?\n\/\/# sourceMappingURL=).+/,
        IS_PROD || !fs.existsSync(map) ? '' :
          '$1data:application/json;charset=utf-8;base64,' +
          fs.readFileSync(map).toString('base64'));
    }
    return new Buffer(str);
  };
  const targets = files.map(f => {
    const [from, to = from] = f.split(/\s*->\s*/);
    const isJS = to.endsWith('.js');
    const npm = from.startsWith('npm:') && from.replace('npm:', 'node_modules/');
    if (npm && isJS) npms[path.basename(npm)] = npm;
    return {
      src: npm || `src/${from}`,
      dest: DST + (
        isJS ? JS :
          /\b(css|images)\b/.test(to) ? ASSETS :
            ''
      ),
      rename: to,
      transform: (isJS || vars && /\.(js(on)?|css|html)$/.test(to)) &&
        transform,
    };
  });
  return Object.assign(copy({targets}), {
    buildStart() {
      for (const f of files) this.addWatchFile(f);
    },
  });
}

function getChunkName(chunk) {
  return path.basename(chunk.facadeModuleId || '') || 'chunk.js';
}

function getFileName(file) {
  return path.parse(file).name;
}

//#endregion
//#region Main

// fse.emptyDir(DST);

export default [
  ...ENTRIES.map(e => makeEntry(e)),
  makeEntryIIFE('/background/background-worker.js'),
  makeEntryIIFE('/edit/editor-worker.js'),
  makeEntryIIFE('/js/color/color-converter.js', 'colorConverter'),
  makeEntryIIFE('/js/csslint/csslint.js', 'CSSLint', {
    external: './parserlib',
    output: {globals: id => id.match(/parserlib/)?.[0] || id},
  }),
  makeEntryIIFE('/js/csslint/parserlib.js', 'parserlib'),
  makeEntryIIFE('/js/meta-parser.js', 'metaParser'),
  makeEntryIIFE('/js/moz-parser.js', 'extractSections'),
];

//#endregion
