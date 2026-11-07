const SUPABASE_URL =
'https://uzbbwvihkfzdbnowhglc.supabase.co';

const SUPABASE_ANON_KEY =
'sb_publishable_a6YEwdDOpkZ6BI8pHXVPnQ_WlFMlHmf';

const ONESIGNAL_APP_ID = 'b98b2b98-8510-49b3-b263-3bdc12dd7c3c';

const sb =
supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
);

function initializeOneSignal() {
    return new Promise((resolve, reject) => {
        window.OneSignalDeferred = window.OneSignalDeferred || [];
        window.OneSignalDeferred.push(async OneSignal => {
            try {
                await OneSignal.init({
                    appId: ONESIGNAL_APP_ID,
                    serviceWorkerPath: 'SeShatHub/onesignal/OneSignalSDKWorker.js',
                    serviceWorkerParam: { scope: '/SeShatHub/onesignal/' }
                });
                const { data:{session} } = await sb.auth.getSession();
                if (session?.user) {
                    await OneSignal.login(session.user.id);
                } else {
                    await OneSignal.logout();
                }
                resolve(OneSignal);
            } catch (error) {
                reject(error);
            }
        });

        const script = document.createElement('script');
        script.src = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';
        script.async = true;
        script.onerror = () => reject(new Error('Could not load the OneSignal SDK.'));
        document.head.appendChild(script);
    });
}

const oneSignalReady = initializeOneSignal();
oneSignalReady.catch(error => {
    console.error('Unable to initialize OneSignal:', error);
});

sb.auth.onAuthStateChange((event, session) => {
    if (event !== 'SIGNED_IN' && event !== 'SIGNED_OUT') {
        return;
    }

    oneSignalReady.then(async OneSignal => {
        if (session?.user) {
            await OneSignal.login(session.user.id);
        } else {
            await OneSignal.logout();
        }
    }).catch(error => {
        console.error('Unable to update OneSignal account identity:', error);
    });
});

window.seshat = {

    supabase: sb,

    getOneSignal() {
        return oneSignalReady;
    },

    async registerServiceWorker() {
        if (!('serviceWorker' in navigator)) {
            return null;
        }

        return navigator.serviceWorker.register('./service-worker.js');
    },

    async scheduleReminders({ itemType, itemId, dueDate, dueTime, url, offsets }) {
        const user = await this.getUser();
        if (!user) {
            throw new Error('You must be signed in to schedule reminders.');
        }

        if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) ||
            !/^\d{2}:\d{2}(?::\d{2})?$/.test(dueTime)) {
            throw new Error('The due date or time is invalid.');
        }

        const [year, month, day] = dueDate.split('-').map(Number);
        const [hours, minutes] = dueTime.split(':').map(Number);
        const dueAt = new Date(year, month - 1, day, hours, minutes);
        if (Number.isNaN(dueAt.getTime()) || dueAt.getFullYear() !== year ||
            dueAt.getMonth() !== month - 1 || dueAt.getDate() !== day ||
            dueAt.getHours() !== hours || dueAt.getMinutes() !== minutes) {
            throw new Error('The due date or time is invalid.');
        }

        const { error: deleteError } = await sb
            .from('push_reminders')
            .delete()
            .eq('user_id', user.id)
            .eq('item_type', itemType)
            .eq('item_id', String(itemId));

        if (deleteError) {
            throw deleteError;
        }

        const reminders = [...new Set(offsets.map(Number))]
            .filter(offset => Number.isInteger(offset) && offset > 0 && offset <= 525600)
            .map(offset => ({
                remindAt: offset === 1440
                    ? new Date(year, month - 1, day - 1, hours, minutes)
                    : new Date(dueAt.getTime() - offset * 60000),
                offset
            }))
            .map(({ offset, remindAt }) => ({
                user_id: user.id,
                item_type: itemType,
                item_id: String(itemId),
                offset_minutes: offset,
                due_on: dueDate,
                due_time: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
                due_at: dueAt.toISOString(),
                remind_at: remindAt.toISOString(),
                url
            }))
            .filter(reminder => new Date(reminder.remind_at) > new Date());

        if (reminders.length === 0) {
            return;
        }

        const { error } = await sb.from('push_reminders').insert(reminders);
        if (error) {
            throw error;
        }
    },

    async getReminderOffsets(itemType, itemId) {
        const user = await this.getUser();
        if (!user) {
            throw new Error('You must be signed in to manage reminders.');
        }

        const { data, error } = await sb
            .from('push_reminders')
            .select('offset_minutes')
            .eq('user_id', user.id)
            .eq('item_type', itemType)
            .eq('item_id', String(itemId));

        if (error) {
            throw error;
        }

        return [...new Set((data || []).map(reminder => reminder.offset_minutes))];
    },

    readReminderOffsets() {
        const offsets = [...document.querySelectorAll('input[name="reminder-offset"]:checked')]
            .map(input => Number(input.value));
        const custom = Number(document.getElementById('customReminderMinutes')?.value);
        if (Number.isInteger(custom) && custom > 0 && custom <= 525600) {
            offsets.push(custom);
        }
        return [...new Set(offsets)];
    },

    async clearReminders(itemType, itemId) {
        const user = await this.getUser();
        if (!user) {
            throw new Error('You must be signed in to manage reminders.');
        }

        const { error } = await sb
            .from('push_reminders')
            .delete()
            .eq('user_id', user.id)
            .eq('item_type', itemType)
            .eq('item_id', String(itemId));

        if (error) {
            throw error;
        }
    },

    async getUser() {

        const {
            data:{user}
        } = await sb.auth.getUser();

        return user;
    },

    async getSession() {

        const {
            data:{session}
        } = await sb.auth.getSession();

        return session;
    },

    async signOut() {

        await sb.auth.signOut();

        location.href = "/";
    }
};

window.seshat.registerServiceWorker().catch(error => {
    console.error('Unable to register the notification service worker:', error);
});
