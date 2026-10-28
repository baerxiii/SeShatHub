const SUPABASE_URL =
'https://cujvvxyadxvlfvhgzlki.supabase.co';

const SUPABASE_ANON_KEY =
'YOUR_ANON_KEY';

const sb =
supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
);

window.seshat = {

    supabase: sb,

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
