import browser from '/js/browser';
import {kGetAccessToken} from '/js/consts';
import {API} from '/js/msg-api';
import * as prefs from '/js/prefs';
import {chromeLocal, chromeSync} from '/js/storage-util';
import {fetchWebDAV, hasOwn} from '/js/util-base';
import {broadcastExtension} from './broadcast';
import {uuidIndex} from './common';
import db from './db';
import {cloudDrive, dbToCloud} from './db-to-cloud-broker';
import {overrideBadge} from './icon-manager';
import * as styleMan from './style-manager';
import {getToken, revokeToken} from './token-manager';

//#region Init

const ALARM_ID = 'syncNow';
const PREF_ID = 'sync.enabled';
const SYNC_DELAY = process.env.MV3
  ? 27 / 60 // ensuring it runs within the minimum lifetime of SW
  : 1;
const SYNC_INTERVAL = 30; // minutes, may be fractional
const CONNECTED = 'connected';
const CONNECTING = 'connecting';
const DISCONNECTED = 'disconnected';
const DISCONNECTING = 'disconnecting';
const PENDING = 'pending';
const STATES = {
  connected: CONNECTED,
  connecting: CONNECTING,
  disconnected: DISCONNECTED,
  disconnecting: DISCONNECTING,
  pending: PENDING,
};
const STORAGE_KEY = 'sync/state/';
const NO_LOGIN = ['webdav'];
const status = /** @namespace SyncManager.Status */ {
  STATES,
  state: PENDING,
  syncing: false,
  progress: null,
  currentDriveName: null,
  errorMessage: null,
  login: false,
};
const compareRevision = (rev1, rev2) => rev1 - rev2;
let lastError = null;
let ctrl;
let curDrive;
let curDriveName;
let delayedInit;
let statusServed;

prefs.subscribe(PREF_ID, async (_, val) => {
  const alarm = await browser.alarms.get(ALARM_ID);
  const isOn = hasOwn(cloudDrive, val);
  delayedInit = isOn && val;
  if (!isOn && alarm) {
    chrome.alarms.clear(ALARM_ID);
  } else if (isOn && (!alarm || alarm.periodInMinutes !== SYNC_INTERVAL)) {
    chrome.alarms.create(ALARM_ID, {
      delayInMinutes: SYNC_DELAY,
      periodInMinutes: SYNC_INTERVAL,
    });
  }
  if (!isOn) {
    status.state = DISCONNECTED;
    if (statusServed) emitStatusChange();
  }
}, true);

chrome.alarms.onAlarm.addListener(a => {
  if (a.name === ALARM_ID) process.env.KEEP_ALIVE(syncNow());
});

//#endregion
//#region Exports

export async function remove(...args) {
  if (delayedInit) await start();
  if (!curDrive) return;
  return ctrl.delete(...args);
}

/** @returns {Promise<SyncManager.Status>} */
export function getStatus() {
  if (delayedInit) start(); // not awaiting (could be slow), we'll broadcast the updates
  statusServed = true;
  return status;
}

export async function login(name) {
  if (delayedInit) await start();
  if (!name) name = curDriveName;
  await revokeToken(name);
  try {
    await getToken(name, true);
    status.login = true;
  } catch (err) {
    status.login = false;
    throw err;
  } finally {
    emitStatusChange();
  }
}

export async function putDoc({_id, _rev}) {
  if (delayedInit) await start();
  if (!curDrive) return;
  return ctrl.put(_id, _rev);
}

export async function setDriveOptions(driveName, options) {
  const key = `secure/sync/driveOptions/${driveName}`;
  await chromeSync.setValue(key, options);
}

export async function getDriveOptions(driveName) {
  const key = `secure/sync/driveOptions/${driveName}`;
  return await chromeSync.getValue(key) || {};
}

export async function start(name = delayedInit) {
  const isInit = name && name === delayedInit;
  const isStop = status.state === DISCONNECTING;
  delayedInit = false;
  if ((ctrl ??= initController()).then) ctrl = await ctrl;
  if (curDrive) return;
  if ((curDrive = getDrive(name)).then) { // preventing re-entry by assigning synchronously
    curDrive = await curDrive;
  }
  ctrl.use(curDrive);
  curDriveName = name;
  status.state = CONNECTING;
  status.currentDriveName = curDriveName;
  emitStatusChange();
  if (isInit || NO_LOGIN.includes(curDriveName)) {
    status.login = true;
  } else {
    try {
      await login(name);
    } catch (err) {
      console.error(err);
      setError(err);
      emitStatusChange();
      return stop();
    }
  }
  await ctrl.init();
  if (isStop) return;
  await syncNow(name);
  prefs.set(PREF_ID, name);
  status.state = CONNECTED;
  emitStatusChange();
}

export async function stop() {
  if (delayedInit) {
    status.state = DISCONNECTING;
    try { await start(); } catch {}
  }
  if (!curDrive) return;
  status.state = DISCONNECTING;
  emitStatusChange();
  try {
    await ctrl.uninit();
    await revokeToken(curDriveName);
    await chromeLocal.remove(STORAGE_KEY + curDriveName);
  } catch {}
  curDrive = curDriveName = null;
  prefs.set(PREF_ID, 'none');
  status.state = DISCONNECTED;
  status.currentDriveName = null;
  status.login = false;
  emitStatusChange();
}

export async function syncNow() {
  if (delayedInit) await start();
  if (!curDrive || !status.login) {
    console.warn('cannot sync when disconnected');
    return;
  }
  try {
    await ctrl.syncNow();
    setError();
  } catch (err) {
    err.message = translateErrorMessage(err);
    setError(err);
    if (isGrantError(err)) {
      status.login = false;
    }
  }
  emitStatusChange();
}

//#endregion
//#region Utils

function initController() {
  return dbToCloud({
    onGet: _id => styleMan.uuid2style(_id) || uuidIndex.custom[_id],
    async onPut(doc) {
      if (!doc) return; // TODO: delete it?
      const id = uuidIndex.get(doc._id);
      const oldCust = !id && uuidIndex.custom[doc._id];
      const oldDoc = oldCust || styleMan.get(id);
      const diff = oldDoc ? compareRevision(oldDoc._rev, doc._rev) : -1;
      if (!diff) return;
      if (diff > 0) {
        putDoc(oldDoc);
      } else if (oldCust) {
        uuidIndex.custom[doc._id] = doc;
      } else {
        delete doc.id;
        if (id) doc.id = id;
        doc.id = await db.put(doc);
        await styleMan.handleSave(doc, 'sync');
      }
    },
    onDelete(_id, rev) {
      const id = uuidIndex.get(_id);
      const oldDoc = styleMan.get(id);
      return oldDoc &&
        compareRevision(oldDoc._rev, rev) <= 0 &&
        styleMan.remove(id, 'sync');
    },
    onFirstSync() {
      for (const i of Object.values(uuidIndex.custom).concat(styleMan.getAll())) {
        ctrl.put(i._id, i._rev);
      }
    },
    onProgress(e) {
      if (e.phase === 'start') {
        status.syncing = true;
      } else if (e.phase === 'end') {
        status.syncing = false;
        status.progress = null;
      } else {
        status.progress = e;
      }
      if (lastError) setError();
      emitStatusChange();
    },
    compareRevision,
    getState(drive) {
      return chromeLocal.getValue(STORAGE_KEY + drive.name);
    },
    setState(drive, state) {
      return chromeLocal.setValue(STORAGE_KEY + drive.name, state);
    },
    retryMaxAttempts: 10,
    retryExp: 1.2,
    retryDelay: 6,
  });
}

function emitStatusChange() {
  broadcastExtension({method: 'syncStatusUpdate', status});
  overrideBadge(getErrorBadge());
}

function isNetworkError(err) {
  return (
    err.name === 'TypeError' && /networkerror|failed to fetch/i.test(err.message) ||
    err.code === 502
  );
}

function isGrantError(err) {
  if (err.code === 401) return true;
  if (err.code === 400 && /invalid_grant/.test(err.message)) return true;
  if (err.name === 'TokenError') return true;
  return false;
}

function getErrorBadge() {
  if (status.state === STATES.connected &&
      (!status.login || lastError && !isNetworkError(lastError))) {
    return {
      text: 'x',
      color: '#F00',
      title: !status.login ? 'syncErrorRelogin' : `${
        chrome.i18n.getMessage('syncError')
      }\n---------------------\n${
        // splitting to limit each line length
        lastError.message.replace(/.{60,}?\s(?=.{30,})/g, '$&\n')
      }`,
    };
  }
}

async function getDrive(name) {
  if (!hasOwn(cloudDrive, name)) throw new Error(`Unknown cloud provider: ${name}`);
  const options = await getDriveOptions(name);
  const webdav = name === 'webdav';
  const getAccessToken = () => getToken(name);
  if (!process.env.MV3) {
    options[kGetAccessToken] = getAccessToken;
    options.fetch = webdav ? fetchWebDAV.bind(options) : fetch;
  } else if (webdav) {
    API.sync[kGetAccessToken] = getAccessToken;
  } else {
    options[kGetAccessToken] = getAccessToken;
  }
  return cloudDrive[name](options);
}

function setError(err) {
  status.errorMessage = err?.message;
  lastError = err;
}

function translateErrorMessage(err) {
  if (err.name === 'LockError') {
    return browser.i18n.getMessage('syncErrorLock',
      new Date(err.expire).toLocaleString([], {timeStyle: 'short'}));
  }
  return err.message || JSON.stringify(err);
}

//#endregion
