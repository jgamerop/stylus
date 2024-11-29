'use strict';

const fs = require('fs');
const path = require('path');
const {BundleAnalyzerPlugin} = require('webpack-bundle-analyzer');

const MANIFEST = 'manifest.json';
const MANIFEST_MV3 = 'manifest-mv3.json';
const ROOT = path.dirname(__dirname.replaceAll('\\', '/')) + '/';
const SRC = ROOT + 'src/';

function addReport(base, {entry}) {
  base.plugins = [
    ...base.plugins || [],
    new BundleAnalyzerPlugin({
      analyzerMode: 'static',
      openAnalyzer: false,
      reportFilename: base.output.path + '/.' + Object.keys(entry).join('-') + '.report.html',
    }),
  ];
}

function anyPathSep(str) {
  return str.replace(/[\\/]/g, /[\\/]/.source);
}

function escapeForRe(str) {
  return str.replace(/[{}()[\]\\.+*?^$|]/g, '\\$&');
}

function escapeToRe(str, flags) {
  return new RegExp(str.replace(/[{}()[\]\\.+*?^$|]/g, '\\$&'), flags);
}

function getBrowserlist() {
  const mv3 = /chrome-(mv3|beta)/.test(process.env.NODE_ENV);
  const mj = require(SRC + (mv3 ? MANIFEST_MV3 : MANIFEST));
  const FF = mj.browser_specific_settings?.gecko.strict_min_version;
  const CH = mj.minimum_chrome_version;
  return [
    FF && 'Firefox >= ' + FF,
    CH && 'Chrome >= ' + CH,
  ].filter(Boolean);
}

function stripSourceMap(buf, from) {
  const str = buf.toString();
  const map = from + '.map';
  const res = str.replace(/(\r?\n\/\/# sourceMappingURL=).+/,
    process.env.NODE_ENV !== 'DEV' || !fs.existsSync(map) ? '' :
      '$1data:application/json;charset=utf-8;base64,' +
      fs.readFileSync(map).toString('base64'));
  return Buffer.from(res);
}

module.exports = {
  MANIFEST,
  MANIFEST_MV3,
  ROOT,
  SRC,
  addReport,
  anyPathSep,
  escapeForRe,
  escapeToRe,
  getBrowserlist,
  stripSourceMap,
};
