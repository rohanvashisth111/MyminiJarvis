/* ─── JARVIS 2.0 — Robust Voice Engine ─── */

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
let isListening   = false;
let isSpeaking    = false;
let recognition   = null;
let sessionActive = false;
let finalBuffer   = "";   // accumulates final results within one session
let commitTimer   = null;
const isMobile    = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
// On mobile, continuous=true is buggy; we use single-shot mode and restart
const USE_CONTINUOUS = !isMobile;
const COMMIT_DELAY   = isMobile ? 500 : 900; // ms after last interim before acting

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
  } else if (mode === "processing") {
    statusText.textContent = "PROCESSING";
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

  const finish = () => {
    isSpeaking = false;
    if (onDone) {
      onDone(); // may navigate away — don't restart mic after this
      return;
    }
    // Only restart mic if no navigation is happening
    if (isListening) {
      setTimeout(() => startSession(), isMobile ? 600 : 200);
    }
  };
  utter.onend   = finish;
  utter.onerror = finish;

  synth.speak(utter);
}

// ================= COMMIT LOGIC =================
function scheduleCommit(text) {
  clearTimeout(commitTimer);
  commitTimer = setTimeout(() => {
    if (text.trim() && !isSpeaking) {
      clearBuffer();
      stopSession();
      processCommand(text.trim());
    }
  }, COMMIT_DELAY);
}

function clearBuffer() {
  finalBuffer = "";
  clearTimeout(commitTimer);
  commitTimer = null;
}

// ================= RECOGNITION SESSION =================
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

function buildRecognition() {
  if (!SR) return null;
  const r = new SR();
  r.continuous      = USE_CONTINUOUS;
  r.interimResults  = true;
  r.lang            = "en-US";
  r.maxAlternatives = 3; // get more alternatives for accent robustness

  r.onstart = () => {
    sessionActive = true;
    setStatus("listening");
  };

  r.onresult = (event) => {
    let interimText = "";
    let newFinal    = "";

    for (let i = event.resultIndex; i < event.results.length; i++) {
      // Pick best alternative that sounds most like a command
      const best = pickBestAlternative(event.results[i]);
      if (event.results[i].isFinal) {
        newFinal += best + " ";
      } else {
        interimText = best;
      }
    }

    if (newFinal) {
      finalBuffer += newFinal;
      transcriptText.textContent = finalBuffer.trim();
      // Reset commit timer with full accumulated text
      scheduleCommit(finalBuffer.trim());
    } else if (interimText) {
      // Show interim but schedule commit on the accumulated final + interim
      transcriptText.textContent = (finalBuffer + interimText).trim();
      scheduleCommit((finalBuffer + interimText).trim());
    }
  };

  r.onspeechend = () => {
    // User stopped — flush immediately
    clearTimeout(commitTimer);
    const text = (finalBuffer).trim();
    if (text && !isSpeaking) {
      clearBuffer();
      stopSession();
      processCommand(text);
    } else if (!isMobile) {
      // On desktop with continuous mode, let onend handle restart
    }
  };

  r.onerror = (e) => {
    sessionActive = false;
    if (e.error === "no-speech") {
      // No speech detected — restart quietly on mobile
      if (isListening && !isSpeaking) setTimeout(() => startSession(), 300);
      return;
    }
    if (e.error === "aborted") return;
    if (e.error === "not-allowed") {
      speak("Microphone access denied. Please allow it in browser settings.");
      isListening = false;
      setStatus("standby");
      return;
    }
    if (e.error === "network") {
      // Mobile network error — try again
      if (isListening && !isSpeaking) setTimeout(() => startSession(), 1000);
      return;
    }
    console.warn("SR error:", e.error);
  };

  r.onend = () => {
    sessionActive = false;
    if (isListening && !isSpeaking) {
      setTimeout(() => startSession(), isMobile ? 400 : 100);
    }
  };

  return r;
}

function startSession() {
  if (!isListening || isSpeaking || sessionActive) return;
  clearBuffer();
  recognition = buildRecognition();
  if (!recognition) return;
  try {
    recognition.start();
  } catch (e) {
    sessionActive = false;
    setTimeout(() => startSession(), 400);
  }
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
// Tries each recognition alternative and picks one that matches a known command pattern
function pickBestAlternative(result) {
  const alts = [];
  for (let i = 0; i < result.length; i++) {
    alts.push(result[i].transcript.trim().toLowerCase());
  }
  // Prefer an alternative that looks like a command (has a verb keyword)
  const keywords = ["open","search","find","play","go to","launch","what","tell","calculate","weather","joke","help","bye","hello","hi","time","date","day"];
  for (const alt of alts) {
    for (const kw of keywords) {
      if (alt.includes(kw)) return alt;
    }
  }
  return alts[0]; // fallback to top result
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
  claude:"https://claude.ai",chatgpt:"https://chat.openai.com",
  openai:"https://openai.com",perplexity:"https://perplexity.ai",
};

function resolveUrl(siteName) {
  const key = siteName.trim().toLowerCase().replace(/[^\w\s]/g,"");
  // Exact match
  if (SITE_MAP[key]) return { url: SITE_MAP[key], name: key };
  // Partial match — site name anywhere in input, or input anywhere in site name
  for (const [alias, url] of Object.entries(SITE_MAP)) {
    const cleanAlias = alias.replace(/[^\w\s]/g,"");
    if (key.includes(cleanAlias) || cleanAlias.includes(key)) return { url, name: alias };
  }
  // Last resort — try constructing URL
  const slug = key.replace(/\s+/g,"");
  return { url: `https://www.${slug}.com`, name: siteName };
}

// ================= INTENT ENGINE =================
// Accent-robust: match on PRESENCE of keyword anywhere, not strict prefix
function normalize(text) {
  return text.toLowerCase()
    .replace(/\bplease\b|\bfor me\b|\bcan you\b|\bcould you\b|\bhey\b|\bjarvis\b|\bjara\b|\bjavis\b/gi,"")
    .replace(/\s+/g," ").trim();
}

// Extract what comes AFTER a trigger word (handles accent/word-order variation)
function extractAfter(cmd, triggers) {
  for (const trigger of triggers) {
    const idx = cmd.indexOf(trigger);
    if (idx !== -1) {
      const after = cmd.slice(idx + trigger.length).trim();
      if (after) return after;
    }
  }
  return null;
}

function getIntent(raw) {
  const cmd = normalize(raw);

  // ── OPEN / NAVIGATE ──
  const openTriggers = ["open","launch","go to","navigate to","take me to","load","visit","show me","start"];
  const openTarget = extractAfter(cmd, openTriggers);
  if (openTarget) return { type:"OPEN_SITE", value: openTarget };

  // ── SEARCH ──
  const searchTriggers = ["search for","search","look up","find","google","bing"];
  const searchTarget = extractAfter(cmd, searchTriggers);
  if (searchTarget) return { type:"SEARCH", value: searchTarget };

  // ── MATH ──
  const mathClean = cmd
    .replace(/calculate|what is|what'?s|how much is/g,"")
    .replace(/\bplus\b/g,"+").replace(/\bminus\b/g,"-")
    .replace(/\btimes\b|\bmultiplied by\b/g,"*").replace(/\bdivided by\b/g,"/")
    .trim();
  if (/^[\d\s\+\-\*\/\^\(\)\.]+$/.test(mathClean) && /\d/.test(mathClean))
    return { type:"CALC", value: mathClean };

  // ── TIME / DATE / DAY ──
  if (/\btime\b/.test(cmd))    return { type:"TIME" };
  if (/\bdate\b/.test(cmd))    return { type:"DATE" };
  if (/\bday\b/.test(cmd))     return { type:"DAY" };

  // ── GREETINGS ──
  if (/\b(hello|hi|hey|howdy|greetings|sup|what's up|wassup)\b/.test(cmd)) return { type:"GREETING" };

  // ── JOKE ──
  if (/\bjoke\b|\blaugh\b|\bfunny\b|\bamuse\b/.test(cmd)) return { type:"JOKE" };

  // ── WEATHER ──
  if (/\bweather\b/.test(cmd)) {
    const place = cmd.replace(/weather|in|of|at|the|what'?s?|how'?s?|is|like|check|today/g,"").trim();
    return { type:"WEATHER", value: place || "" };
  }

  // ── HELP ──
  if (/\bhelp\b|\bwhat can you do\b|\bcommands\b/.test(cmd)) return { type:"HELP" };

  // ── BYE ──
  if (/\b(bye|goodbye|see you|stop|quit|exit|turn off|deactivate)\b/.test(cmd)) return { type:"BYE" };

  // ── FALLBACK: if only one word that's a known site, open it ──
  const words = cmd.trim().split(/\s+/);
  if (words.length <= 2) {
    for (const w of words) {
      if (SITE_MAP[w]) return { type:"OPEN_SITE", value: w };
    }
  }

  return { type:"UNKNOWN", raw: cmd };
}

// ================= JOKES =================
const JOKES = [
  "Why don't scientists trust atoms? Because they make up everything.",
  "I told my computer I needed a break. Now it won't stop sending me Kit-Kat ads.",
  "Why did the programmer quit his job? Because he didn't get arrays.",
  "There are 10 types of people — those who understand binary, and those who don't.",
  "Why do Java developers wear glasses? Because they don't C sharp.",
  "My password is 'incorrect'. So when I forget it, the site tells me: your password is incorrect.",
];

// ================= ACTION ENGINE =================
function navigate(url) {
  // On mobile, window.open is blocked as popup — always use location.href
  window.location.href = url;
}

function executeIntent(intent) {
  switch (intent.type) {
    case "OPEN_SITE": {
      const { url, name } = resolveUrl(intent.value);
      speak(`Opening ${name}`, () => navigate(url));
      break;
    }
    case "SEARCH":
      if (!intent.value) { speak("What should I search for?"); return; }
      speak(`Searching for ${intent.value}`, () => {
        navigate(`https://www.google.com/search?q=${encodeURIComponent(intent.value)}`);
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
      speak("Hello! How can I help you today?");
      break;
    case "JOKE":
      speak(JOKES[Math.floor(Math.random() * JOKES.length)]);
      break;
    case "WEATHER":
      speak(`Checking weather${intent.value ? " for " + intent.value : ""}`, () => {
        navigate(`https://www.google.com/search?q=weather+${encodeURIComponent(intent.value)}`);
      });
      break;
    case "HELP":
      speak("You can say: open YouTube, search something, what time is it, calculate 5 plus 3, tell me a joke, weather in Delhi, or goodbye.");
      break;
    case "BYE":
      speak("Goodbye!", () => {
        isListening = false;
        stopSession();
        setStatus("standby");
      });
      break;
    default:
      speak(`I heard: ${intent.raw || "something unclear"}. Try saying open YouTube, or search for something.`);
  }
}

// ================= PROCESS =================
function processCommand(text) {
  if (!text.trim()) return;
  addMessage(text, "user");
  setStatus("processing");
  executeIntent(getIntent(text));
}

// ================= ORB TOGGLE =================
orb.onclick = () => {
  if (!SR) {
    speak("Voice recognition is not supported in this browser. Please use Chrome or Safari.");
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
    // On mobile, we speak first then start (requires gesture chain)
    speak("Listening. What can I do for you?", () => startSession());
  }
};

// ================= MOBILE: keep mic alive on visibility change =================
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopSession();
  } else if (isListening && !isSpeaking) {
    setTimeout(() => startSession(), 500);
  }
});
