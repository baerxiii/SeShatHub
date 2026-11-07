self.addEventListener('push', event => {
    let payload = {};
    try {
        payload = event.data ? event.data.json() : {};
    } catch (error) {
        console.error('Unable to parse push notification:', error);
    }

    const title = payload.title || 'SeShat reminder';
    const options = {
        body: payload.body || 'Something is due soon.',
        icon: './icon.svg',
        badge: './icon.svg',
        tag: payload.tag || 'seshat-reminder',
        data: { url: payload.url || './index.html' }
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const target = new URL(event.notification.data?.url || './index.html', self.location.href).href;

    event.waitUntil((async () => {
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of clients) {
            if (client.url === target && 'focus' in client) {
                return client.focus();
            }
        }
        return self.clients.openWindow(target);
    })());
});
