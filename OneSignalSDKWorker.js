// Single service worker for the whole site. Root domain → scope "/".
// Do NOT rename or move this file after launch: changing the worker URL
// forces a full subscriber migration in OneSignal.
importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");
