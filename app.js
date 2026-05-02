/* ─── JARVIS 2.0 — Fast Response Engine ─── */

// ================= DOM =================
const chat           = document.getElementById("chat");
const statusDot      = document.getElementById("statusDot");
const statusText     = document.getElementById("statusText");
const clockEl        = document.getElementById("clock");
const orb            = document.getElementById("orb");
const waveform       = document.getElementById("waveform");
const transcriptBox  = document.getElementById("transcriptBox");
const transcriptText = document.getElementById("transcriptText");

// ================= CLOCK =================
function updateClock() {
  const now = new Date();
  clockEl.textContent =
    String(now.getHours()).padStart(2,"0") + ":" +
    String(now.getMinutes()).padStart(2,"0") + ":" +
    String(now.getSeconds()).padStart(2,"0");
}
updateClock();
setInterval(updateClock, 1000);

// ================= STATE =================
let isListening  = false;
let isSpeaking   = false;
let recognition  = null;
let commitTimer  = null;   // fires when user pauses mid-speech
let pendingText  = "";     // best interim text so far
let sessionActive = false;

const COMMIT_DELAY = 800; // ms of silence before we act on interim text

// ================= UI =================
function setStatus(mode) {
  statusDot.className     = "status-dot";
  statusText.className    = "status-text";
  orb.className           = "orb";
  waveform.className      = "waveform";
  transcriptBox.className = "transcript-box";

  if (mode === "listening") {
    statusDot.classList.add("active");
    statusText.classList.add("active");
    statusText.textContent = "LISTENING";
    orb.classList.add("listening");
    waveform.classList.add("active");
    transcriptBox.classList.add("active");
  } else if (mode === "speaking") {
    statusDot.classList.add("speaking");
    statusText.classList.add("speaking");
    statusText.textContent = "SPEAKING";
    orb.classList.add("speaking");
  } else {
    statusText.textContent  = "TAP ORB TO START";
    transcriptText.textContent = "—";
  }
}

function addMessage(text, type) {
  const time = new Date().toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });

  const div    = document.createElement("div");
  div.className = "msg " + type;

  const avatar = document.createElement("div");
  avatar.className  = "msg-avatar";
  avatar.textContent = type === "user" ? "YOU" : "AI";

  const wrap   = document.createElement("div");
  wrap.className = "msg-wrap";

  const bubble = document.createElement("div");
  bubble.className  = "msg-bubble";
  bubble.textContent = text;

  const ts = document.createElement("div");
  ts.className  = "msg-time";
  ts.textContent = time;

  wrap.appendChild(bubble);
  wrap.appendChild(ts);
  div.appendChild(avatar);
  div.appendChild(wrap);
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

// ================= SPEECH SYNTHESIS =================
const synth = window.speechSynthesis;

// Chrome bug: synth silently pauses after ~15s
setInterval(() => { if (synth.speaking) { synth.pause(); synth.resume(); } }, 10000);

function getVoice() {
  const voices = synth.getVoices();
  return voices.find(v => v.lang === "en-US" && /google/i.test(v.name))
      || voices.find(v => v.lang === "en-US")
      || voices.find(v => v.lang.startsWith("en"))
      || null;
}
if (speechSynthesis.onvoiceschanged !== undefined) {
  speechSynthesis.onvoiceschanged = () => getVoice();
}

function speak(text, onDone) {
  synth.cancel();
  isSpeaking = true;
  setStatus("speaking");
  addMessage(text, "bot");

  const utter = new SpeechSynthesisUtterance(text);
  const voice = getVoice();
  if (voice) utter.voice = voice;
  utter.rate  = 1.1;
  utter.pitch = 1;

  utter.onend = utter.onerror = () => {
    isSpeaking = false;
    if (onDone) onDone();
    if (isListening) startSession();
  };

  synth.speak(utter);
}

// ================= COMMIT LOGIC =================
// Called whenever we have new interim text.
// If no new text arrives within COMMIT_DELAY ms, we treat it as finished.
function scheduleCommit(text) {
  pendingText = text;
  clearTimeout(commitTimer);
  commitTimer = setTimeout(() => {
    if (pendingText.trim() && !isSpeaking) {
      const cmd = pendingText.trim();
      pendingText = "";
      // Stop current session so we don't pick up our own voice reply
      stopSession();
      processCommand(cmd);
    }
  }, COMMIT_DELAY);
}

function cancelCommit() {
  clearTimeout(commitTimer);
  commitTimer  = null;
  pendingText  = "";
}

// ================= RECOGNITION SESSION =================
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

function buildRecognition() {
  if (!SR) return null;
  const r = new SR();
  r.continuous      = true;   // keep stream open so WE control timing
  r.interimResults  = true;   // get words as you speak
  r.lang            = "en-US";
  r.maxAlternatives = 1;

  r.onresult = (event) => {
    let interimText = "";
    let finalText   = "";

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const t = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalText += t;
      } else {
        interimText += t;
      }
    }

    const best = (finalText || interimText).trim();
    if (!best) return;

    // Show live in transcript
    transcriptText.textContent = best;

    if (finalText.trim()) {
      // Browser confirmed final — act immediately, no timer needed
      cancelCommit();
      stopSession();
      processCommand(finalText.trim());
    } else {
      // Interim — schedule commit if user pauses
      scheduleCommit(interimText.trim());
    }
  };

  r.onspeechend = () => {
    // User stopped talking — flush whatever we have NOW, don't wait
    clearTimeout(commitTimer);
    commitTimer = null;
    if (pendingText.trim() && !isSpeaking) {
      const cmd = pendingText.trim();
      pendingText = "";
      stopSession();
      processCommand(cmd);
    }
  };

  r.onerror = (e) => {
    if (e.error === "no-speech" || e.error === "aborted") return;
    if (e.error === "not-allowed") {
      speak("Microphone access denied. Please allow it in browser settings.");
      isListening = false;
      setStatus("standby");
      return;
    }
    console.warn("SR error:", e.error);
  };

  r.onend = () => {
    sessionActive = false;
    // Auto-restart if still supposed to be listening and not mid-speak
    if (isListening && !isSpeaking) {
      setTimeout(() => startSession(), 100);
    }
  };

  return r;
}

function startSession() {
  if (!isListening || isSpeaking || sessionActive) return;
  cancelCommit();
  recognition = buildRecognition();
  if (!recognition) return;
  try {
    recognition.start();
    sessionActive = true;
    setStatus("listening");
  } catch (e) {
    sessionActive = false;
    setTimeout(() => startSession(), 300);
  }
}

function stopSession() {
  cancelCommit();
  sessionActive = false;
  if (recognition) {
    try { recognition.abort(); } catch (_) {}
    recognition = null;
  }
}

// ================= WEBSITE DIRECTORY =================
const SITE_MAP = {
  youtube:"https://youtube.com","you tube":"https://youtube.com",
  instagram:"https://instagram.com",insta:"https://instagram.com",
  facebook:"https://facebook.com",fb:"https://facebook.com",
  twitter:"https://twitter.com",x:"https://x.com",
  tiktok:"https://tiktok.com","tik tok":"https://tiktok.com",
  snapchat:"https://snapchat.com",snap:"https://snapchat.com",
  linkedin:"https://linkedin.com",pinterest:"https://pinterest.com",
  reddit:"https://reddit.com",discord:"https://discord.com",
  telegram:"https://web.telegram.org",whatsapp:"https://web.whatsapp.com",
  threads:"https://threads.net",
  google:"https://google.com",bing:"https://bing.com",
  gmail:"https://mail.google.com",
  drive:"https://drive.google.com","google drive":"https://drive.google.com",
  docs:"https://docs.google.com","google docs":"https://docs.google.com",
  sheets:"https://sheets.google.com",calendar:"https://calendar.google.com",
  notion:"https://notion.so",slack:"https://slack.com",
  figma:"https://figma.com",github:"https://github.com",
  amazon:"https://amazon.in",flipkart:"https://flipkart.com",
  myntra:"https://myntra.com",meesho:"https://meesho.com",
  nykaa:"https://nykaa.com",ebay:"https://ebay.com",
  etsy:"https://etsy.com",ajio:"https://ajio.com",
  netflix:"https://netflix.com",spotify:"https://open.spotify.com",
  prime:"https://primevideo.com","prime video":"https://primevideo.com",
  hotstar:"https://hotstar.com",
  "disney plus":"https://disneyplus.com",disneyplus:"https://disneyplus.com",
  twitch:"https://twitch.tv",
  bbc:"https://bbc.com",cnn:"https://cnn.com",ndtv:"https://ndtv.com",
  "times of india":"https://timesofindia.com",toi:"https://timesofindia.com",
  "the hindu":"https://thehindu.com",thehindu:"https://thehindu.com",
  maps:"https://maps.google.com","google maps":"https://maps.google.com",
  makemytrip:"https://makemytrip.com",irctc:"https://irctc.co.in",
  paytm:"https://paytm.com",phonepe:"https://phonepe.com",
  gpay:"https://pay.google.com","google pay":"https://pay.google.com",
};

function resolveUrl(siteName) {
  const key = siteName.trim().toLowerCase();
  if (SITE_MAP[key]) return { url: SITE_MAP[key], name: key };
  for (const [alias, url] of Object.entries(SITE_MAP)) {
    if (key.includes(alias) || alias.includes(key)) return { url, name: alias };
  }
  return { url: `https://www.${key.replace(/\s+/g,"")}.com`, name: key };
}

// ================= INTENT ENGINE =================
function normalize(text) {
  return text.toLowerCase()
    .replace(/\bplease\b|\bfor me\b|\bcan you\b|\bcould you\b|\bhey\b|\bjarvis\b/gi,"")
    .replace(/\s+/g," ").trim();
}

function getIntent(raw) {
  const cmd = normalize(raw);

  const openMatch = cmd.match(/^(?:open|launch|go to|take me to|navigate to|load|show me|visit)\s+(.+)$/);
  if (openMatch) return { type:"OPEN_SITE", value: openMatch[1].trim() };

  const searchMatch = cmd.match(/^(?:search(?:\s+for)?|look up|find|google)\s+(.+)$/);
  if (searchMatch) return { type:"SEARCH", value: searchMatch[1].trim() };

  const calcCmd = cmd
    .replace(/calculate|what'?s?|what is/g,"")
    .replace(/plus/g,"+").replace(/minus/g,"-")
    .replace(/times|multiplied by/g,"*").replace(/divided by/g,"/")
    .trim();
  if (/^[\d\s\+\-\*\/\^\(\)\.]+$/.test(calcCmd) && /\d/.test(calcCmd))
    return { type:"CALC", value: calcCmd };

  if (cmd.includes("time"))   return { type:"TIME" };
  if (cmd.includes("date"))   return { type:"DATE" };
  if (cmd.includes("day"))    return { type:"DAY" };
  if (/\b(hello|hi|hey|howdy|greetings)\b/.test(cmd)) return { type:"GREETING" };
  if (cmd.includes("joke") || cmd.includes("make me laugh")) return { type:"JOKE" };
  if (cmd.includes("weather")) {
    const place = cmd.replace(/weather|in|of|at|the|what'?s?|how'?s?|is|like/g,"").trim();
    return { type:"WEATHER", value: place || "your location" };
  }
  if (cmd.includes("help") || cmd.includes("what can you do")) return { type:"HELP" };
  if (/\b(bye|goodbye|see you|stop|quit)\b/.test(cmd)) return { type:"BYE" };

  return { type:"UNKNOWN" };
}

// ================= JOKES =================
const JOKES = [
  "Why don't scientists trust atoms? Because they make up everything.",
  "I told my computer I needed a break. Now it won't stop sending me Kit-Kat ads.",
  "Why did the programmer quit his job? Because he didn't get arrays.",
  "There are 10 types of people — those who understand binary, and those who don't.",
  "Why do Java developers wear glasses? Because they don't C sharp.",
];

// ================= ACTION ENGINE =================
function executeIntent(intent) {
  switch (intent.type) {
    case "OPEN_SITE": {
      const { url, name } = resolveUrl(intent.value);
      speak(`Opening ${name}`, () => { window.location.href = url; });
      break;
    }
    case "SEARCH":
      if (!intent.value) { speak("What should I search for?"); return; }
      speak(`Searching for ${intent.value}`, () => {
        window.location.href = `https://www.google.com/search?q=${encodeURIComponent(intent.value)}`;
      });
      break;
    case "CALC":
      try {
        // eslint-disable-next-line no-new-func
        const result = Function(`"use strict"; return (${intent.value})`)();
        speak(`That equals ${result}`);
      } catch { speak("I couldn't calculate that."); }
      break;
    case "TIME":
      speak("It's " + new Date().toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" }));
      break;
    case "DATE":
      speak("Today is " + new Date().toLocaleDateString([], { weekday:"long", year:"numeric", month:"long", day:"numeric" }));
      break;
    case "DAY":
      speak("Today is " + new Date().toLocaleDateString([], { weekday:"long" }));
      break;
    case "GREETING":
      speak("Hello! How can I help you?");
      break;
    case "JOKE":
      speak(JOKES[Math.floor(Math.random() * JOKES.length)]);
      break;
    case "WEATHER":
      speak(`Checking weather for ${intent.value}`, () => {
        const q = intent.value === "your location" ? "" : intent.value;
        window.location.href = `https://www.google.com/search?q=weather+${encodeURIComponent(q)}`;
      });
      break;
    case "HELP":
      speak("I can open websites, search the web, tell time, calculate math, tell jokes, and check weather.");
      break;
    case "BYE":
      speak("Goodbye!", () => {
        isListening = false;
        stopSession();
        setStatus("standby");
      });
      break;
    default:
      speak("I didn't catch that. Try: open YouTube, search something, or what's the time.");
  }
}

// ================= PROCESS =================
function processCommand(text) {
  if (!text.trim()) return;
  addMessage(text, "user");
  executeIntent(getIntent(text));
}

// ================= ORB TOGGLE =================
orb.onclick = () => {
  if (!SR) { alert("Speech recognition requires Chrome or Edge."); return; }

  if (isListening) {
    isListening = false;
    stopSession();
    setStatus("standby");
    speak("Going to standby.");
  } else {
    isListening = true;
    speak("Listening.", () => startSession());
  }
};