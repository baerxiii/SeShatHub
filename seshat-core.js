const SUPABASE_URL =
'https://uzbbwvihkfzdbnowhglc.supabase.co';

const SUPABASE_ANON_KEY =
'sb_publishable_a6YEwdDOpkZ6BI8pHXVPnQ_WlFMlHmf';

function createIos12SupabaseShim(url, anonKey) {
    var storageKey = "sb-uzbbwvihkfzdbnowhglc-auth-token";
    var session = null;

    try {
        var rawSaved = localStorage.getItem(storageKey);
        if (rawSaved) {
            session = JSON.parse(rawSaved);
        }
    } catch (_) {
        session = null;
    }

    function saveSession(nextSession) {
        session = nextSession || null;
        try {
            if (session) {
                localStorage.setItem(storageKey, JSON.stringify(session));
            } else {
                localStorage.removeItem(storageKey);
            }
        } catch (_) {}
    }

    function getAuthHeaders(useUserToken) {
        var token = (useUserToken && session && session.access_token)
            ? session.access_token
            : anonKey;
        return {
            "Content-Type": "application/json",
            "apikey": anonKey,
            "Authorization": "Bearer " + token
        };
    }

    function parsePostgrestCount(contentRange) {
        if (!contentRange) return 0;
        var parts = String(contentRange).split("/");
        if (parts.length === 2) {
            var n = parseInt(parts[1], 10);
            return Number.isFinite(n) ? n : 0;
        }
        return 0;
    }

    function buildQuery(table) {
        var selectCols = "*";
        var isHead = false;
        var wantCount = false;
        var filters = [];
        var orderClause = null;
        var limitCount = null;

        function encodeVal(v) {
            return encodeURIComponent(String(v));
        }

        function executeRequest(method, bodyObj, singleRow) {
            var qs = ["select=" + encodeURIComponent(selectCols)];
            for (var i = 0; i < filters.length; i++) {
                qs.push(filters[i]);
            }
            if (orderClause) {
                qs.push("order=" + encodeURIComponent(orderClause));
            }
            if (limitCount !== null) {
                qs.push("limit=" + encodeURIComponent(String(limitCount)));
            }

            var reqUrl = url + "/rest/v1/" + encodeURIComponent(table) + (qs.length ? "?" + qs.join("&") : "");
            var headers = getAuthHeaders(true);
            if (wantCount || isHead) {
                headers["Prefer"] = "count=exact";
            }
            if (method === "POST") {
                headers["Prefer"] = (headers["Prefer"] ? headers["Prefer"] + "," : "") + "return=representation";
            }

            var fetchMethod = isHead ? "HEAD" : method;
            var opts = {
                method: fetchMethod,
                headers: headers
            };
            if (bodyObj !== undefined && fetchMethod !== "HEAD" && fetchMethod !== "GET") {
                opts.body = JSON.stringify(bodyObj);
            }

            return fetch(reqUrl, opts).then(function(res) {
                var countVal = parsePostgrestCount(res.headers.get("content-range"));
                if (!res.ok) {
                    return res.text().then(function(txt) {
                        var errObj = { message: txt || ("HTTP " + res.status), status: res.status };
                        return { data: null, error: errObj, count: countVal };
                    });
                }
                if (fetchMethod === "HEAD" || res.status === 204) {
                    return { data: null, error: null, count: countVal };
                }
                return res.text().then(function(txt) {
                    var parsed = null;
                    if (txt) {
                        try { parsed = JSON.parse(txt); } catch (_) { parsed = null; }
                    }
                    if (singleRow) {
                        var row = Array.isArray(parsed) ? (parsed[0] || null) : parsed;
                        return { data: row, error: null, count: countVal };
                    }
                    return { data: parsed, error: null, count: countVal };
                });
            }).catch(function(err) {
                return {
                    data: null,
                    error: { message: err && err.message ? err.message : String(err) },
                    count: 0
                };
            });
        }

        var builder = {
            select: function(cols, opts) {
                if (cols) selectCols = cols;
                if (opts && opts.head) isHead = true;
                if (opts && opts.count === "exact") wantCount = true;
                return builder;
            },
            eq: function(col, val) {
                filters.push(encodeURIComponent(col) + "=eq." + encodeVal(val));
                return builder;
            },
            gte: function(col, val) {
                filters.push(encodeURIComponent(col) + "=gte." + encodeVal(val));
                return builder;
            },
            order: function(col, opts) {
                var dir = (opts && opts.ascending === false) ? "desc" : "asc";
                orderClause = col + "." + dir;
                return builder;
            },
            limit: function(n) {
                limitCount = n;
                return builder;
            },
            insert: function(payload) {
                return executeRequest("POST", payload, false);
            },
            delete: function() {
                return executeRequest("DELETE", undefined, false);
            },
            then: function(resolve, reject) {
                return executeRequest("GET", undefined, false).then(resolve, reject);
            }
        };

        return builder;
    }

    var useNativeClient = false;
    var nativeClient = null;
    try {
        var ua = (typeof navigator !== "undefined" && navigator.userAgent) ? navigator.userAgent : "";
        var isIos12OrOlder = /OS (?:10|11|12)_/.test(ua) && /iPhone|iPad|iPod/.test(ua);
        if (!isIos12OrOlder && typeof supabase !== "undefined" && supabase && typeof supabase.createClient === "function") {
            nativeClient = supabase.createClient(url, anonKey);
            useNativeClient = true;
        }
    } catch (_) {
        useNativeClient = false;
    }

    if (useNativeClient && nativeClient) {
        return nativeClient;
    }

    return {
        auth: {
            signInWithPassword: function(credentials) {
                return fetch(url + "/auth/v1/token?grant_type=password", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "apikey": anonKey,
                        "Authorization": "Bearer " + anonKey
                    },
                    body: JSON.stringify({
                        email: credentials.email,
                        password: credentials.password
                    })
                }).then(function(res) {
                    return res.json().then(function(data) {
                        if (!res.ok) {
                            return {
                                data: { user: null, session: null },
                                error: { message: (data && (data.msg || data.error_description || data.message)) || ("HTTP " + res.status) }
                            };
                        }
                        var nextSession = {
                            access_token: data.access_token,
                            refresh_token: data.refresh_token,
                            expires_in: data.expires_in,
                            token_type: data.token_type,
                            user: data.user
                        };
                        saveSession(nextSession);
                        return {
                            data: { user: data.user || null, session: nextSession },
                            error: null
                        };
                    });
                }).catch(function(err) {
                    return {
                        data: { user: null, session: null },
                        error: { message: err && err.message ? err.message : String(err) }
                    };
                });
            },
            signUp: function(credentials) {
                return fetch(url + "/auth/v1/signup", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "apikey": anonKey,
                        "Authorization": "Bearer " + anonKey
                    },
                    body: JSON.stringify({
                        email: credentials.email,
                        password: credentials.password
                    })
                }).then(function(res) {
                    return res.json().then(function(data) {
                        if (!res.ok) {
                            return {
                                data: { user: null, session: null },
                                error: { message: (data && (data.msg || data.error_description || data.message)) || ("HTTP " + res.status) }
                            };
                        }
                        if (data && data.access_token) {
                            saveSession({
                                access_token: data.access_token,
                                refresh_token: data.refresh_token,
                                expires_in: data.expires_in,
                                token_type: data.token_type,
                                user: data.user
                            });
                        }
                        return {
                            data: { user: data.user || null, session: session },
                            error: null
                        };
                    });
                }).catch(function(err) {
                    return {
                        data: { user: null, session: null },
                        error: { message: err && err.message ? err.message : String(err) }
                    };
                });
            },
            getSession: function() {
                if (!session) {
                    return Promise.resolve({ data: { session: null }, error: null });
                }
                return Promise.resolve({ data: { session: session }, error: null });
            },
            getUser: function() {
                if (!session || !session.access_token) {
                    return Promise.resolve({ data: { user: null }, error: null });
                }
                return fetch(url + "/auth/v1/user", {
                    method: "GET",
                    headers: getAuthHeaders(true)
                }).then(function(res) {
                    if (!res.ok) {
                        return { data: { user: session.user || null }, error: null };
                    }
                    return res.json().then(function(userData) {
                        var resolvedUser = userData || session.user || null;
                        if (resolvedUser && session) {
                            session.user = resolvedUser;
                            saveSession(session);
                        }
                        return { data: { user: resolvedUser }, error: null };
                    });
                }).catch(function() {
                    return { data: { user: session.user || null }, error: null };
                });
            },
            signOut: function() {
                var headers = getAuthHeaders(true);
                saveSession(null);
                return fetch(url + "/auth/v1/logout", {
                    method: "POST",
                    headers: headers
                }).then(function() {
                    return { error: null };
                }).catch(function() {
                    return { error: null };
                });
            }
        },
        from: function(table) {
            return buildQuery(table);
        }
    };
}

var sb = createIos12SupabaseShim(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
);

window.seshat = {

    supabase: sb,

    registerServiceWorker: function() {
        if (!("serviceWorker" in navigator)) {
            return Promise.resolve(null);
        }

        return navigator.serviceWorker.register("./service-worker.js");
    },

    scheduleReminders: function(options) {
        var self = this;
        var itemType = options.itemType;
        var itemId = options.itemId;
        var dueDate = options.dueDate;
        var dueTime = options.dueTime;
        var url = options.url;
        var offsets = options.offsets || [];

        return self.getUser().then(function(user) {
            if (!user) {
                throw new Error("You must be signed in to schedule reminders.");
            }

            if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) ||
                !/^\d{2}:\d{2}(?::\d{2})?$/.test(dueTime)) {
                throw new Error("The due date or time is invalid.");
            }

            var dateParts = dueDate.split("-").map(Number);
            var year = dateParts[0];
            var month = dateParts[1];
            var day = dateParts[2];
            var timeParts = dueTime.split(":").map(Number);
            var hours = timeParts[0];
            var minutes = timeParts[1];
            var dueAt = new Date(year, month - 1, day, hours, minutes);

            if (Number.isNaN(dueAt.getTime()) || dueAt.getFullYear() !== year ||
                dueAt.getMonth() !== month - 1 || dueAt.getDate() !== day ||
                dueAt.getHours() !== hours || dueAt.getMinutes() !== minutes) {
                throw new Error("The due date or time is invalid.");
            }

            return sb
                .from("push_reminders")
                .delete()
                .eq("user_id", user.id)
                .eq("item_type", itemType)
                .eq("item_id", String(itemId))
                .then(function(delRes) {
                    if (delRes && delRes.error) {
                        throw delRes.error;
                    }

                    var uniqueOffsets = [];
                    for (var i = 0; i < offsets.length; i++) {
                        var num = Number(offsets[i]);
                        if (Number.isInteger(num) && num > 0 && num <= 525600 && uniqueOffsets.indexOf(num) === -1) {
                            uniqueOffsets.push(num);
                        }
                    }

                    var nowMs = Date.now();
                    var reminders = [];
                    for (var j = 0; j < uniqueOffsets.length; j++) {
                        var offset = uniqueOffsets[j];
                        var remindAt = offset === 1440
                            ? new Date(year, month - 1, day - 1, hours, minutes)
                            : new Date(dueAt.getTime() - offset * 60000);

                        if (remindAt.getTime() > nowMs) {
                            reminders.push({
                                user_id: user.id,
                                item_type: itemType,
                                item_id: String(itemId),
                                offset_minutes: offset,
                                due_on: dueDate,
                                due_time: String(hours).padStart(2, "0") + ":" + String(minutes).padStart(2, "0"),
                                due_at: dueAt.toISOString(),
                                remind_at: remindAt.toISOString(),
                                url: url
                            });
                        }
                    }

                    if (reminders.length === 0) {
                        return null;
                    }

                    return sb.from("push_reminders").insert(reminders).then(function(insRes) {
                        if (insRes && insRes.error) {
                            throw insRes.error;
                        }
                        return null;
                    });
                });
        });
    },

    getReminderOffsets: function(itemType, itemId) {
        return this.getUser().then(function(user) {
            if (!user) {
                throw new Error("You must be signed in to manage reminders.");
            }

            return sb
                .from("push_reminders")
                .select("offset_minutes")
                .eq("user_id", user.id)
                .eq("item_type", itemType)
                .eq("item_id", String(itemId))
                .then(function(res) {
                    if (res && res.error) {
                        throw res.error;
                    }
                    var rows = Array.isArray(res && res.data) ? res.data : [];
                    var unique = [];
                    for (var i = 0; i < rows.length; i++) {
                        var val = rows[i].offset_minutes;
                        if (unique.indexOf(val) === -1) {
                            unique.push(val);
                        }
                    }
                    return unique;
                });
        });
    },

    readReminderOffsets: function() {
        var checkedInputs = document.querySelectorAll('input[name="reminder-offset"]:checked');
        var offsets = [];
        for (var i = 0; i < checkedInputs.length; i++) {
            offsets.push(Number(checkedInputs[i].value));
        }
        var customEl = document.getElementById("customReminderMinutes");
        var custom = customEl ? Number(customEl.value) : NaN;
        if (Number.isInteger(custom) && custom > 0 && custom <= 525600) {
            offsets.push(custom);
        }
        var unique = [];
        for (var j = 0; j < offsets.length; j++) {
            if (unique.indexOf(offsets[j]) === -1) {
                unique.push(offsets[j]);
            }
        }
        return unique;
    },

    clearReminders: function(itemType, itemId) {
        return this.getUser().then(function(user) {
            if (!user) {
                throw new Error("You must be signed in to manage reminders.");
            }

            return sb
                .from("push_reminders")
                .delete()
                .eq("user_id", user.id)
                .eq("item_type", itemType)
                .eq("item_id", String(itemId))
                .then(function(res) {
                    if (res && res.error) {
                        throw res.error;
                    }
                    return null;
                });
        });
    },

    getUser: function() {
        return sb.auth.getUser().then(function(res) {
            return (res && res.data) ? res.data.user : null;
        });
    },

    getSession: function() {
        return sb.auth.getSession().then(function(res) {
            return (res && res.data) ? res.data.session : null;
        });
    },

    signOut: function() {
        return sb.auth.signOut().then(function() {
            location.href = "/";
        });
    }
};

if (window.seshat && typeof window.seshat.registerServiceWorker === "function") {
    window.seshat.registerServiceWorker().catch(function(error) {
        console.error("Unable to register the notification service worker:", error);
    });
}
