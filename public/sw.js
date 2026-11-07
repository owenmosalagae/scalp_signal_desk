self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: "window" }).then(windows => {
    if (windows.length) return windows[0].focus();
    return self.clients.openWindow("/");
  }));
});
