/* ─── JARVIS — Mobile-First Voice Engine ─── */

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

// ================= DEVICE =================
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

// ================= STATE =================
let isListening   = false;
let isSpeaking    = false;
let recognition   = null;
let sessionActive = false;
let finalBuffer   = "";
let commitTimer   = null;

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
    statusText.textContent     = "TAP ORB TO START";
    transcriptText.textContent = "—";
  }
}

function addMessage(text, type) {
  const time = new Date().toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });
  const div    = document.createElement("div");
  div.className = "msg " + type;
  const avatar = document.createElement("div");
  avatar.className   = "msg-avatar";
  avatar.textContent = type === "user" ? "YOU" : "AI";
  const wrap   = document.createElement("div");
  wrap.className = "msg-wrap";
  const bubble = document.createElement("div");
  bubble.className   = "msg-bubble";
  bubble.textContent = text;
  const ts = document.createElement("div");
  ts.className   = "msg-time";
  ts.textContent = time;
  wrap.appendChild(bubble);
  wrap.appendChild(ts);
  div.appendChild(avatar);
  div.appendChild(wrap);
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

// ================= SPEECH =================
const synth = window.speechSynthesis;

function getVoice() {
  const voices = synth.getVoices();
  return voices.find(v => v.lang === "en-US" && /google/i.test(v.name))
      || voices.find(v => v.lang === "en-US")
      || voices.find(v => v.lang.startsWith("en"))
      || null;
}
if (speechSynthesis.onvoiceschanged !== undefined) speechSynthesis.onvoiceschanged = getVoice;

// Fire-and-forget speak — never blocks navigation
function speak(text) {
  synth.cancel();
  addMessage(text, "bot");
  setStatus("speaking");
  isSpeaking = true;

  const utter = new SpeechSynthesisUtterance(text);
  const voice = getVoice();
  if (voice) utter.voice = voice;
  utter.rate  = 1.05;
  utter.pitch = 1;

  const done = () => {
    isSpeaking = false;
    if (isListening) setTimeout(() => startSession(), isMobile ? 700 : 250);
  };
  utter.onend   = done;
  utter.onerror = done;

  // Safety fallback — mobile onend sometimes never fires
  const safeDuration = text.length * 70 + 1000;
  setTimeout(() => { if (isSpeaking) done(); }, safeDuration);

  synth.speak(utter);
}

// ================= NAVIGATION =================
// Navigate immediately — never wait for speech
function navigate(url) {
  stopSession();
  isListening = false;
  setTimeout(() => { window.location.href = url; }, 350);
}

// ================= COMMIT LOGIC =================
function scheduleCommit(text) {
  clearTimeout(commitTimer);
  commitTimer = setTimeout(() => {
    if (text.trim() && !isSpeaking) {
      const cmd = text.trim();
      finalBuffer = "";
      stopSession();
      processCommand(cmd);
    }
  }, isMobile ? 600 : 900);
}

function clearBuffer() {
  finalBuffer = "";
  clearTimeout(commitTimer);
  commitTimer = null;
}

// ================= RECOGNITION =================
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

function buildRecognition() {
  if (!SR) return null;
  const r = new SR();
  r.continuous      = !isMobile; // continuous breaks on mobile
  r.interimResults  = true;
  r.lang            = "en-US";
  r.maxAlternatives = 3;

  r.onstart = () => {
    sessionActive = true;
    setStatus("listening");
    transcriptText.textContent = "—";
  };

  r.onresult = (event) => {
    let interim = "";
    let final   = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const text = pickBest(event.results[i]);
      if (event.results[i].isFinal) final += text + " ";
      else interim = text;
    }
    if (final) {
      finalBuffer += final;
      transcriptText.textContent = finalBuffer.trim();
      scheduleCommit(finalBuffer.trim());
    } else if (interim) {
      transcriptText.textContent = (finalBuffer + interim).trim();
      scheduleCommit((finalBuffer + interim).trim());
    }
  };

  r.onspeechend = () => {
    clearTimeout(commitTimer);
    const text = finalBuffer.trim();
    if (text && !isSpeaking) {
      finalBuffer = "";
      stopSession();
      processCommand(text);
    }
  };

  r.onerror = (e) => {
    sessionActive = false;
    if (["no-speech","aborted"].includes(e.error)) {
      if (isListening && !isSpeaking) setTimeout(() => startSession(), 400);
      return;
    }
    if (e.error === "not-allowed") {
      isListening = false;
      addMessage("Mic blocked. Allow microphone in browser settings then refresh.", "bot");
      setStatus("standby");
      return;
    }
    if (isListening && !isSpeaking) setTimeout(() => startSession(), 1000);
  };

  r.onend = () => {
    sessionActive = false;
    if (isListening && !isSpeaking) setTimeout(() => startSession(), 300);
  };

  return r;
}

function startSession() {
  if (!isListening || isSpeaking || sessionActive) return;
  clearBuffer();
  recognition = buildRecognition();
  if (!recognition) return;
  try { recognition.start(); }
  catch (e) { sessionActive = false; setTimeout(() => startSession(), 500); }
}

function stopSession() {
  clearBuffer();
  sessionActive = false;
  if (recognition) {
    try { recognition.abort(); } catch (_) {}
    recognition = null;
  }
}

// ================= PICK BEST ALTERNATIVE =================
function pickBest(result) {
  const alts = Array.from({length: result.length}, (_, i) =>
    result[i].transcript.toLowerCase().trim()
  );
  const kw = ["open","launch","search","find","go","play","what","tell","weather","joke","help","bye","hi","hello","time","date","day","calculate"];
  for (const alt of alts) {
    if (kw.some(k => alt.includes(k))) return alt;
  }
  return alts[0] || "";
}

// ================= SITE MAP =================
const SITE_MAP = {
  youtube:"https://youtube.com","you tube":"https://youtube.com",
  instagram:"https://instagram.com",insta:"https://instagram.com",
  facebook:"https://facebook.com",fb:"https://facebook.com",
  twitter:"https://twitter.com",
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
  "the hindu":"https://thehindu.com",
  maps:"https://maps.google.com","google maps":"https://maps.google.com",
  makemytrip:"https://makemytrip.com",irctc:"https://irctc.co.in",
  paytm:"https://paytm.com",phonepe:"https://phonepe.com",
  gpay:"https://pay.google.com","google pay":"https://pay.google.com",
  claude:"https://claude.ai",chatgpt:"https://chat.openai.com",
  openai:"https://openai.com",perplexity:"https://perplexity.ai",
};

function resolveUrl(siteName) {
  const key = siteName.trim().toLowerCase().replace(/[^\w\s]/g,"").trim();
  if (SITE_MAP[key]) return { url: SITE_MAP[key], name: key };
  for (const [alias, url] of Object.entries(SITE_MAP)) {
    const a = alias.replace(/[^\w\s]/g,"");
    if (key.includes(a) || a.includes(key)) return { url, name: alias };
  }
  return { url: `https://www.${key.replace(/\s+/g,"")}.com`, name: siteName };
}

// ================= INTENT ENGINE =================
function normalize(text) {
  return text.toLowerCase()
    .replace(/\b(please|for me|can you|could you|hey|jarvis|javis|jara|ok|okay)\b/g,"")
    .replace(/\s+/g," ").trim();
}

function extractAfter(cmd, triggers) {
  for (const t of triggers) {
    const idx = cmd.indexOf(t);
    if (idx !== -1) {
      const after = cmd.slice(idx + t.length).trim();
      if (after) return after;
    }
  }
  return null;
}

function getIntent(raw) {
  const cmd = normalize(raw);

  const openTarget = extractAfter(cmd,
    ["open","launch","go to","navigate to","take me to","load","visit","show me","start","bring up"]);
  if (openTarget) return { type:"OPEN_SITE", value: openTarget };

  const searchTarget = extractAfter(cmd,
    ["search for","search","look up","find","google","bing"]);
  if (searchTarget) return { type:"SEARCH", value: searchTarget };

  const mathClean = cmd
    .replace(/calculate|compute|what is|what's|how much is/g,"")
    .replace(/\bplus\b/g,"+").replace(/\bminus\b/g,"-")
    .replace(/\btimes\b|\bmultiplied by\b/g,"*").replace(/\bdivided by\b/g,"/")
    .trim();
  if (/^[\d\s\+\-\*\/\^\(\)\.]+$/.test(mathClean) && /\d/.test(mathClean))
    return { type:"CALC", value: mathClean };

  if (/\btime\b/.test(cmd))  return { type:"TIME" };
  if (/\bdate\b/.test(cmd))  return { type:"DATE" };
  if (/\bday\b/.test(cmd))   return { type:"DAY" };

  if (/\b(hello|hi|hey|howdy|greetings|sup|wassup)\b/.test(cmd)) return { type:"GREETING" };
  if (/\b(joke|funny|laugh|amuse)\b/.test(cmd))                  return { type:"JOKE" };

  if (/\bweather\b/.test(cmd)) {
    const place = cmd.replace(/\b(weather|in|of|at|the|what|how|is|like|check|today|s)\b/g,"").trim();
    return { type:"WEATHER", value: place };
  }

  if (/\b(help|commands|what can you do)\b/.test(cmd)) return { type:"HELP" };
  if (/\b(bye|goodbye|see you|stop|quit|exit|turn off)\b/.test(cmd)) return { type:"BYE" };

  // Bare site name (no open keyword)
  const words = cmd.trim().split(/\s+/);
  for (const w of words) {
    if (SITE_MAP[w]) return { type:"OPEN_SITE", value: w };
  }
  if (words.length >= 2) {
    for (let i = 0; i < words.length - 1; i++) {
      const pair = words[i] + " " + words[i+1];
      if (SITE_MAP[pair]) return { type:"OPEN_SITE", value: pair };
    }
  }

  return { type:"UNKNOWN", raw: cmd };
}

// ================= JOKES =================
const JOKES = [
  "Why don't scientists trust atoms? Because they make up everything.",
  "I told my computer I needed a break. Now it won't stop sending me Kit-Kat ads.",
  "Why did the programmer quit his job? Because he didn't get arrays.",
  "There are 10 types of people in the world — those who understand binary, and those who don't.",
  "Why do Java developers wear glasses? Because they don't C sharp.",
  "My password is incorrect. So when I forget it, the site helpfully tells me: your password is incorrect.",
];

// ================= EXECUTE =================
// CRITICAL: For navigation, addMessage + navigate IMMEDIATELY. speak() is side-effect only.
function executeIntent(intent) {
  switch (intent.type) {

    case "OPEN_SITE": {
      const { url, name } = resolveUrl(intent.value);
      speak(`Opening ${name}`);  // fire and forget
      navigate(url);             // act immediately
      break;
    }

    case "SEARCH": {
      if (!intent.value) { speak("What should I search for?"); return; }
      const q = `https://www.google.com/search?q=${encodeURIComponent(intent.value)}`;
      speak(`Searching for ${intent.value}`);
      navigate(q);
      break;
    }

    case "WEATHER": {
      const place = intent.value || "";
      speak(`Checking weather${place ? " for " + place : ""}`);
      navigate(`https://www.google.com/search?q=weather+${encodeURIComponent(place)}`);
      break;
    }

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

    case "HELP":
      speak("Try: open YouTube, search for cricket score, weather in Delhi, what time is it, or tell me a joke.");
      break;

    case "BYE":
      speak("Goodbye!");
      isListening = false;
      stopSession();
      setTimeout(() => setStatus("standby"), 1500);
      break;

    default:
      speak(`I heard: ${intent.raw || "something unclear"}. Try saying open YouTube or search for something.`);
  }
}

// ================= PROCESS =================
function processCommand(text) {
  if (!text.trim()) return;
  addMessage(text, "user");
  executeIntent(getIntent(text));
}

// ================= ORB =================
orb.addEventListener("click", () => {
  if (!SR) {
    addMessage("Voice not supported. Please use Chrome on Android or Safari on iOS.", "bot");
    return;
  }

  if (isListening) {
    isListening = false;
    stopSession();
    synth.cancel();
    isSpeaking = false;
    setStatus("standby");
  } else {
    isListening = true;
    // Start mic FIRST (needs the tap gesture on mobile)
    startSession();
    // Then speak welcome after short delay
    setTimeout(() => speak("Listening. What can I do for you?"), 150);
  }
});

// ================= VISIBILITY =================
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopSession();
  else if (isListening && !isSpeaking) setTimeout(() => startSession(), 600);
});
