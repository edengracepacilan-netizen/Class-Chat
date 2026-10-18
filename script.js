
const SUPABASE_URL = "https://ohbytewmjcybxbtwaqsc.supabase.co";
const SUPABASE_KEY = "sb_publishable_P20OO7E4hAUYURpeug-gEg_FLnR2BHa";

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const authScreen = document.getElementById("auth-screen");
const chatScreen = document.getElementById("chat-screen");
const authForm = document.getElementById("auth-form");
const authMessage = document.getElementById("auth-message");
const displayName = document.getElementById("display-name");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const signupBtn = document.getElementById("signup-btn");
const logoutBtn = document.getElementById("logout-btn");
const who = document.getElementById("who");
const messageList = document.getElementById("messages");
const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");

let currentUser = null;
const names = {};
let channel = null;
let authInitialized = false;



async function signUp() {
    const name = displayName.value.trim();
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (name.length < 2 || name.length > 24) {
        authMessage.textContent =
            "Enter a display name (2 to 24 characters).";
        return;
    }

    authMessage.textContent = "Creating your account...";
    signupBtn.disabled = true;

    try {
        const { data, error } = await sb.auth.signUp({
            email: email,
            password: password,
            options: {
                data: {
                    display_name: name
                }
            }
        });

        if (error) {
            authMessage.textContent = error.message;
            return;
        }

        if (!data.session) {
            authMessage.textContent =
                "Account created! Check your email to confirm, then log in.";
            return;
        }

        authMessage.textContent = "Account created successfully!";
    } catch (error) {
        authMessage.textContent =
            "Sign up failed: " + error.message;
    } finally {
        signupBtn.disabled = false;
    }
}


async function logIn() {
    authMessage.textContent = "Logging in...";

    try {
        const { error } = await sb.auth.signInWithPassword({
            email: emailInput.value.trim(),
            password: passwordInput.value
        });

        authMessage.textContent = error ? error.message : "";
    } catch (error) {
        authMessage.textContent =
            "Connection failed. Check your Supabase Project URL and internet connection.";
        console.error(error);
    }
}

authForm.addEventListener("submit", (event) => {
    event.preventDefault();
    logIn();
});

signupBtn.addEventListener("click", () => {
    if (authForm.reportValidity()) {
        signUp();
    }
});

// LOG OUT
logoutBtn.addEventListener("click", async () => {
    const { error } = await sb.auth.signOut();

    if (error) {
        console.error("Logout failed:", error.message);
    }
});

// AUTH STATE
sb.auth.onAuthStateChange((event, session) => {
    const user = session ? session.user : null;

    setTimeout(() => {
        if (user && (!currentUser || currentUser.id !== user.id)) {
            startChat(user);
        }

        if (!user && currentUser) {
            stopChat();
        }

        authInitialized = true;
    }, 0);
});

// START CHAT
async function startChat(user) {
    currentUser = user;
    authScreen.hidden = true;
    chatScreen.hidden = false;
    who.textContent = "Loading...";

    await loadNames();

    names[user.id] =
        names[user.id] ||
        user.user_metadata?.display_name ||
        user.email ||
        "User";

    who.textContent = names[user.id];

    await loadMessages();
    listenForNewMessage();

    messageInput.focus();
}

// STOP CHAT
function stopChat() {
    currentUser = null;

    if (channel) {
        sb.removeChannel(channel);
    }

    channel = null;
    messageList.innerHTML = "";
    passwordInput.value = "";
    chatScreen.hidden = true;
    authScreen.hidden = false;
}

// DISPLAY MESSAGE
function showMessage(msg) {
    if (!currentUser || !msg) return;

    if (messageList.querySelector('[data-id="' + msg.id + '"]')) {
        return;
    }

    const isMine = msg.user_id === currentUser.id;
    const item = document.createElement("li");

    item.className = isMine ? "message mine" : "message";
    item.dataset.id = msg.id;

    const author = document.createElement("span");
    author.className = "author";
    author.textContent = names[msg.user_id] || "Unknown";

    const text = document.createElement("p");
    text.textContent = msg.content;

    const time = document.createElement("time");
    time.dateTime = msg.created_at;
    time.textContent = new Date(msg.created_at).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit"
    });

    item.append(author, text, time);
    messageList.appendChild(item);
    messageList.scrollTop = messageList.scrollHeight;
}

// SEND MESSAGE
messageForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!currentUser) return;

    const content = messageInput.value.trim();

    if (!content) return;

    if (content.startsWith("/")) {
        messageInput.value = "";
        await handleCommand(content);
        return;
    }

    messageInput.value = "";

    const { data, error } = await sb
        .from("messages")
        .insert({
            user_id: currentUser.id,
            content: content
        })
        .select("id, user_id, content, created_at")
        .single();

    if (error) {
        alert("Could not send: " + error.message);
        messageInput.value = content;
        return;
    }

    showMessage(data);
});

// LOAD DISPLAY NAMES
async function loadNames() {
    const { data, error } = await sb
        .from("profiles")
        .select("id, display_name");

    if (error) {
        console.error("Could not load profiles:", error.message);
        return;
    }

    data.forEach((profile) => {
        names[profile.id] = profile.display_name || "User";
    });
}

// GET A USER'S NAME
async function nameFor(userId) {
    if (names[userId]) {
        return names[userId];
    }

    const { data, error } = await sb
        .from("profiles")
        .select("display_name")
        .eq("id", userId)
        .maybeSingle();

    if (error) {
        console.error("Could not load name:", error.message);
    }

    names[userId] = data?.display_name || "User";
    return names[userId];
}

// LOAD MESSAGES
async function loadMessages() {
    const { data, error } = await sb
        .from("messages")
        .select("id, user_id, content, created_at")
        .order("created_at", { ascending: false })
        .limit(50);

    if (error) {
        console.error("Could not load messages:", error.message);
        return;
    }

    messageList.innerHTML = "";

    for (const msg of data.reverse()) {
        await nameFor(msg.user_id);
        showMessage(msg);
    }
}

// REAL-TIME MESSAGES
function listenForNewMessage() {
    if (channel) {
        sb.removeChannel(channel);
    }

    channel = sb
        .channel("class-chat")
        .on(
            "postgres_changes",
            {
                event: "INSERT",
                schema: "public",
                table: "messages"
            },
            async (payload) => {
                await nameFor(payload.new.user_id);
                showMessage(payload.new);
            }
        )
        .on(
            "postgres_changes",
            {
                event: "DELETE",
                schema: "public",
                table: "messages"
            },
            (payload) => {
                removeMessage(payload.old.id);
            }
        )
        .subscribe((status) => {
            console.log("Chat realtime status:", status);
        });
}

// REMOVE MESSAGE
function removeMessage(id) {
    const item = messageList.querySelector('[data-id="' + id + '"]');

    if (item) {
        item.remove();
    }
}

// WEATHER API
const GEO_URL = "https://geocoding-api.open-meteo.com/v1/search";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";

function describeWeather(code) {
    if (code === 0) return "Clear sky";
    if ([1, 2, 3].includes(code)) return "Partly cloudy";
    if ([45, 48].includes(code)) return "Foggy";
    if ([51, 53, 55, 56, 57].includes(code)) return "Drizzle";
    if ([61, 63, 65, 66, 67].includes(code)) return "Rain";
    if ([71, 73, 75, 77].includes(code)) return "Snow";
    if ([80, 81, 82].includes(code)) return "Rain showers";
    if ([85, 86].includes(code)) return "Snow showers";
    if ([95, 96, 99].includes(code)) return "Thunderstorm";

    return "Unknown weather";
}

// GET WEATHER
async function getWeather(city) {
    const geoUrl =
        GEO_URL + "?name=" + encodeURIComponent(city) + "&count=1";

    const geoResponse = await fetch(geoUrl);

    if (!geoResponse.ok) {
        throw new Error("Geocoding service failed.");
    }

    const geoData = await geoResponse.json();

    if (!geoData.results || geoData.results.length === 0) {
        return "Sorry, I could not find a city named " + city + ".";
    }

    const place = geoData.results[0];

    const weatherUrl =
        WEATHER_URL +
        "?latitude=" + place.latitude +
        "&longitude=" + place.longitude +
        "&current=temperature_2m,weather_code,wind_speed_10m";

    const weatherResponse = await fetch(weatherUrl);

    if (!weatherResponse.ok) {
        throw new Error("Weather service failed.");
    }

    const weatherData = await weatherResponse.json();
    const now = weatherData.current;

    return (
        "Weather in " + place.name +
        (place.country ? ", " + place.country : "") +
        ": " + now.temperature_2m + "°C, " +
        describeWeather(now.weather_code) +
        ", wind " + now.wind_speed_10m + " km/h."
    );
}

// CHAT COMMANDS
async function handleCommand(text) {
    const words = text.trim().split(/\s+/);

    if (words[0].toLowerCase() !== "/weather") {
        showBotMessage("Unknown command. Try: /weather Manila");
        return;
    }

    const city = words.slice(1).join(" ").trim();

    if (!city) {
        showBotMessage("Try it like this: /weather Manila");
        return;
    }

    try {
        showBotMessage(await getWeather(city));
    } catch (error) {
        console.error("Weather error:", error);
        showBotMessage(
            "The weather service is not answering right now."
        );
    }
}

function showBotMessage(text) {
    const item = document.createElement("li");
    item.className = "message bot-message";

    const author = document.createElement("span");
    author.className = "author";
    author.textContent = "WeatherBot (only you can see this)";

    const body = document.createElement("p");
    body.textContent = text;

    item.append(author, body);
    messageList.appendChild(item);
    messageList.scrollTop = messageList.scrollHeight;
}
