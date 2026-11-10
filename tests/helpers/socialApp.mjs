import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
export const read = (file) => fs.readFileSync(new URL('../../' + file, import.meta.url), 'utf8');
export const manifest = JSON.parse(read('manifest.json'));

export async function bootSocial({ html, url = 'https://x.com/home', settings = {}, stored = {}, profileHtml, postHtml, responseUrl, setup } = {}) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const window = dom.window;
  const storage = { settings: { request: { minIntervalMs: 0 }, ...settings }, ...stored };
  const storageListeners = [], bgListeners = [], listeners = [], requests = [];
  const chrome = {
    runtime: {
      getManifest: () => manifest,
      onMessage: { addListener: (listener) => listeners.push(listener) },
      sendMessage(message, callback = () => {}) { for (const listener of bgListeners) listener(message, { tab: { id: 1, url } }, callback); }
    },
    storage: {
      local: {
        get(keys, callback) {
          const names = keys == null ? Object.keys(storage) : Array.isArray(keys) ? keys : [keys];
          callback(Object.fromEntries(names.filter((key) => key in storage).map((key) => [key, storage[key]])));
        },
        set(values, callback = () => {}) {
          const changes = {};
          for (const [key, value] of Object.entries(values)) { changes[key] = { oldValue: storage[key], newValue: value }; storage[key] = value; }
          callback(); for (const listener of storageListeners) listener(changes, 'local');
        },
        remove(keys, callback) { for (const key of Array.isArray(keys) ? keys : [keys]) delete storage[key]; callback(); }
      },
      onChanged: { addListener: (listener) => storageListeners.push(listener) }
    },
    action: { setBadgeText(_value, callback) { callback(); }, setBadgeBackgroundColor(_value, callback) { callback?.(); } }
  };
  window.chrome = chrome;
  const background = vm.createContext({ URL, AbortController, setTimeout, clearTimeout, console,
    chrome: { ...chrome, runtime: { ...chrome.runtime, onMessage: { addListener: (listener) => bgListeners.push(listener) }, onInstalled: { addListener() {} }, onStartup: { addListener() {} } } },
    fetch: async (target, options) => {
      requests.push({ url: target, credentials: options.credentials });
      const body = new URL(target).pathname.match(/^\/(p|reel)\//) ? postHtml : profileHtml;
      return { ok: true, url: responseUrl || target, text: async () => String((await (typeof body === 'function' ? body(target) : body)) || '<html><title>Login</title></html>').padEnd(1100, ' ') };
    }
  });
  background.importScripts = (...files) => files.forEach((file) => vm.runInContext(read(file.replace(/^\//, '')), background));
  vm.runInContext(read(manifest.background.service_worker), background);
  if (setup) setup(window);
  for (const file of manifest.content_scripts[1].js) window.eval(read(file));
  async function waitFor(condition) {
    const deadline = Date.now() + 4000;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error('Timed out waiting for social extension state: ' + JSON.stringify([...window.OutlierFinder.socialState.results.values()]));
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  const message = (type) => new Promise((resolve) => listeners.forEach((listener) => listener({ type }, {}, resolve)));
  return { window, storage, chrome, requests, background, waitFor, message,
    close() { window.OutlierFinder.socialState.observer?.stop(); window.close(); } };
}

export async function openSocialPopup(app, url) {
  const popup = new JSDOM(read('popup/popup.html'), { url: 'chrome-extension://fixture/popup/popup.html', runScripts: 'outside-only' });
  popup.window.chrome = { ...app.chrome, tabs: {
    query(_value, callback) { callback([{ id: 1, url }]); },
    sendMessage(_id, message, callback) { app.message(message.type).then(callback); }
  } };
  for (const script of popup.window.document.querySelectorAll('script[src]')) {
    const file = new URL(script.getAttribute('src'), new URL('../../popup/popup.html', import.meta.url));
    popup.window.eval(fs.readFileSync(file, 'utf8'));
  }
  return popup;
}
