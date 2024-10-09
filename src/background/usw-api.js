import {deepEqual, mapObj, RX_META, tryURL, UCD, URLS} from '/js/toolbox';
import {broadcastExtension} from './broadcast';
import {API} from './common';
import * as styleMan from './style-manager';
import {getToken, revokeToken} from './token-manager';

const KEYS_OUT = ['description', 'homepage', 'license', 'name'];
const KEYS_IN = [...KEYS_OUT, 'id', 'namespace', 'username'];
const pushId = id => API.data.set('usw' + id, true);
const popId = id => API.data.del('usw' + id);

class TokenHooks {
  constructor(id) {
    this.id = id;
  }
  keyName(name) {
    return `${name}/${this.id}`;
  }
  query(query) {
    return Object.assign(query, {vendor_data: this.id});
  }
}

function fakeUsercssHeader(style, usw) {
  const {namespace: ns, username: user} = usw || (usw = {});
  const meta = [
    'name',
    // Same as USO-archive version: YYYYMMDD.hh.mm
    ['@version', new Date().toISOString().replace(/^(\d+)-(\d+)-(\d+)T(\d+):(\d+).+/, '$1$2$3.$4.$5')],
    ['@namespace', ns !== '?' && ns ||
      user && `https://userstyles.world/user/${user}` ||
      '?'],
    'description',
    ['@homepage', tryURL(ns).href],
    ['@author', user],
    'license',
  ].map((k, _) => k.map ? k[1] && k : (_ = usw[k] || style[k]) && ['@' + k, _]).filter(Boolean);
  const maxKeyLen = meta.reduce((res, [k]) => Math.max(res, k.length), 0);
  return '/* ==UserStyle==\n' +
    meta.map(([k, v]) => `${k}${' '.repeat(maxKeyLen - k.length + 2)}${v}\n`).join('') +
    '==/UserStyle== */\n\n';
}

async function linkStyle(style, sourceCode) {
  const {id, name} = style;
  const {metadata} = await API.worker.parseUsercssMeta(sourceCode.match(RX_META)[0]);
  const out = {name, sourceCode, [UCD]: {}};
  const KEY = 'usw' + id;
  for (const k of KEYS_OUT) out[k] = out[UCD][k] = metadata[k] || '';
  API.data.set(KEY, out);
  try {
    const token = await getToken('userstylesworld', true, new TokenHooks(id));
    const info = await uswFetch('style', token);
    const data = mapObj(info, null, style[UCD] ? ['id'] : KEYS_IN);
    data.token = token;
    style.url = style.url || info.homepage || `${URLS.usw}style/${data.id}`;
    return data;
  } finally {
    API.data.del(KEY);
  }
}

async function uswFetch(path, token, opts) {
  opts = Object.assign({credentials: 'omit'}, opts);
  opts.headers = Object.assign({Authorization: `Bearer ${token}`}, opts.headers);
  return (await (await fetch(`${URLS.usw}api/${path}`, opts)).json()).data;
}

/** Uses a custom method when broadcasting and avoids needlessly sending the entire style */
async function uswSave(style, _usw) {
  const {id} = style;
  if (_usw) style._usw = _usw;
  await styleMan.save(style, {broadcast: false});
  broadcastExtension({method: 'uswData', style: {id, _usw}});
}

/**
 * @param {number} id
 * @param {string} code
 * @param {USWorldData} [usw]
 * @return {Promise<any>}
 */
export async function publish(id, code, usw) {
  try {
    pushId(id);
    const style = styleMan.get(id);
    if (!usw) usw = style._usw;
    if (!style[UCD]) code = fakeUsercssHeader(style, usw) + code;
    if (!usw || !usw.token || !usw.id) usw = await linkStyle(style, code);
    const res = await uswFetch(`style/${usw.id}`, usw.token, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({code}),
    });
    if (!deepEqual(usw, style._usw)) {
      await uswSave(style, usw);
    }
    return res;
  } finally {
    popId(id);
  }
}

/**
 * @param {number} id
 * @return {Promise<void>}
 */
export async function revoke(id) {
  try {
    API.data.set('usw' + id, true);
    await revokeToken('userstylesworld', new TokenHooks(id));
    const style = styleMan.get(id);
    if (style) {
      delete style._usw.token;
      await uswSave(style);
    }
  } finally {
    API.data.del('usw' + id);
  }
}