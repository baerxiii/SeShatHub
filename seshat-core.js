const SUPABASE_URL =
'https://uzbbwvihkfzdvnowhglc.supabase.co';

const SUPABASE_ANON_KEY =
'sb_publishable_a6YEwdDOpkZ6BI8pHXVPnQ_WlFMlHmf';

const supabaseClient =
window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
);

window.seshat = {
    supabase: supabaseClient
};
