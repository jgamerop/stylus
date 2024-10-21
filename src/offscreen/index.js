import {kGetAccessToken} from '/js/consts';
import {API} from '/js/msg-api';
import {initRemotePort} from '/js/port';
import {fetchWebDAV, isCssDarkScheme} from '/js/util-base';
import createWebDAV from 'db-to-cloud/lib/drive/webdav';

let webdav;

/** @namespace OffscreenAPI */
const COMMANDS = {
  __proto__: null,
  webdavInit: cfg => {
    cfg.fetch = fetchWebDAV.bind(cfg);
    cfg[kGetAccessToken] = API.sync[kGetAccessToken];
    webdav = createWebDAV(cfg);
    for (const k in webdav) if (typeof webdav[k] === 'function') webdav[k] = null;
    return webdav;
  },
  webdav: (cmd, ...args) => webdav[cmd](...args),
  /** Note that `onchange` doesn't work in bg context, so we use it in the content script */
  isDark: isCssDarkScheme,
  /** @this {RemotePortEvent} */
  getWorkerPort(url) {
    const port = new SharedWorker(url).port;
    this._transfer = [port];
    return port;
  },
};

/** @param {MessageEvent} evt */
navigator.serviceWorker.onmessage = evt => initRemotePort(evt, COMMANDS, true);
