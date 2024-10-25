import {CHROME} from '/js/ua';
import {browserWindows} from '/js/util-webext';

export const bgReady = (r => Object.assign(new Promise(cb => (r = cb)), {resolve: r}))();
export const browserCommands = {};

export const uuidIndex = Object.assign(new Map(), {
  custom: {},
  /** `obj` must have a unique `id`, a UUIDv4 `_id`, and Date.now() for `_rev`. */
  addCustom(obj, {get = () => obj, set}) {
    Object.defineProperty(uuidIndex.custom, obj._id, {get, set});
  },
});

export let isVivaldi = !!(browserWindows && CHROME) && (async () => {
  const wnd = (await browserWindows.getAll())[0] ||
    await new Promise(resolve => browserWindows.onCreated.addListener(function onCreated(w) {
      browserWindows.onCreated.removeListener(onCreated);
      resolve(w);
    }));
  isVivaldi = wnd && !!(wnd.vivExtData || wnd.extData);
  return isVivaldi;
})();

if (!process.env.MV3) {
  global._ready = bgReady;
  global._bg = true; // for IS_BG check
}
