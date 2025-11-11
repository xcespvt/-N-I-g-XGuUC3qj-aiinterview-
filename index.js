'use strict';

// ==== Heygen API config with rotation ====
const HEYGEN_KEYS = [
  'sk_V2_hgu_kahMRZuiVII_HTXSumNoiaykeRJ8Kvmp0FbUxYoiPJod',
  'sk_V2_hgu_kqPJprW8Od8_QK8JBqDX59Rmjmz8EKUSaUitk0gWRkkm',
  'sk_V2_hgu_kWJ7D2mKPir_4L1Sh3q7tytE47UW6w4S1j4gmU0JDozx'
  // Add more keys here if you have them
];

function getRandomKey() {
  const idx = Math.floor(Math.random() * HEYGEN_KEYS.length);
  return HEYGEN_KEYS[idx];
}

// Assign a random key for this session
const HEYGEN = {
  apiKey: getRandomKey(),
  serverUrl: 'https://api.heygen.com',
};

console.log('🎯 Using Heygen API Key:', HEYGEN.apiKey.substring(0, 10) + '...');


// ==== DOM ====
const DOM = {
  avatarVideo: document.querySelector('#avatarVideo'),
  userVideo: document.querySelector('#userVideo'),
  startBtn: document.querySelector('#startInterviewBtn'),
  closeBtn: document.querySelector('#closeBtn'),
  startAnswerBtn: document.querySelector('#startAnswerBtn'),
  endAnswerBtn: document.querySelector('#endAnswerBtn'),
  answerCta: document.querySelector('#answerCta'),
  recordingBadge: document.querySelector('#recordingBadge'),
  answerHint: document.querySelector('#answerHint'),
  roleSelect: document.querySelector('#roleSelect'),
  userEmail: document.querySelector('#userEmail'),
  status: document.querySelector('#status'),
  resultBox: document.querySelector('#resultBox'),
  profileInfo: document.querySelector('#profileInfo'),
  profileNameBadge: document.querySelector('#profileNameBadge'),
  profileEmailBadge: document.querySelector('#profileEmailBadge'),
  profileOccupationBadge: document.querySelector('#profileOccupationBadge'),
  profileRateBadge: document.querySelector('#profileRateBadge'),
};

// ==== State ====
let sessionInfo = null;
let pc = null;
let userStream = null;
let qIndex = 0;
let questions = [];
let answers = [];
let isRecording = false;

// Recorder state
let recorder = null;
let recordedChunks = [];
let recordResolve = null;
let countdownIv = null;

let candidateProfile = null;

function loadCandidateProfile() {
  try {
    const raw = sessionStorage.getItem('candidateProfile');
    candidateProfile = raw ? JSON.parse(raw) : null;
    if (candidateProfile) {
      // Populate UI badges
      DOM.profileNameBadge.textContent = `Name: ${candidateProfile.name}`;
      DOM.profileEmailBadge.textContent = `Email: ${candidateProfile.email}`;
      DOM.profileOccupationBadge.textContent = `Occupation: ${candidateProfile.occupation}`;
      const rate = typeof candidateProfile.hourlyRate === 'number' ? candidateProfile.hourlyRate.toFixed(2) : candidateProfile.hourlyRate;
      DOM.profileRateBadge.textContent = `Rate: €${rate}/h`;
      DOM.profileInfo.classList.remove('hidden');

      // Prefill email
      if (candidateProfile.email) DOM.userEmail.value = candidateProfile.email;

      // Ensure roleSelect contains occupation and select it
      const occ = candidateProfile.occupation;
      if (occ) {
        let found = false;
        [...DOM.roleSelect.options].forEach((opt) => { if (opt.text === occ) found = true; });
        if (!found) {
          const opt = document.createElement('option');
          opt.text = occ;
          DOM.roleSelect.add(opt);
        }
        DOM.roleSelect.value = occ;
      }
    }
  } catch { }
}

async function startRecording(maxSeconds = 60) {
  if (!userStream) await initUserCam();
  recordedChunks = [];
  recorder = new MediaRecorder(userStream, { mimeType: 'video/webm' });

  const blobPromise = new Promise((resolve) => {
    recordResolve = resolve;
  });

  recorder.ondataavailable = (e) => {
    if (e.data) recordedChunks.push(e.data);
  };
  recorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    if (recordResolve) recordResolve(blob);
  };

  recorder.start();
  isRecording = true;
  DOM.recordingBadge.classList.remove('hidden');
  DOM.recordingBadge.textContent = `Recording… ${maxSeconds}s`;

  let remaining = maxSeconds;
  clearInterval(countdownIv);
  countdownIv = setInterval(() => {
    remaining -= 1;
    DOM.recordingBadge.textContent = `Recording… ${remaining}s`;
    if (remaining <= 0) {
      stopRecording();
    }
  }, 1000);

  return blobPromise;
}

async function stopRecording() {
  if (!recorder || recorder.state === 'inactive') return;
  clearInterval(countdownIv);
  isRecording = false;
  DOM.recordingBadge.classList.add('hidden');
  try {
    recorder.stop();
  } catch { }
}

// ==== Logger ====
function log(msg) {
  DOM.status.innerHTML += msg + '<br>';
  DOM.status.scrollTop = DOM.status.scrollHeight;
}

// ==== Speak helper ====
async function say(session_id, text) {
  const cleanText =
    typeof text === 'string' ? text : text?.content ? text.content : JSON.stringify(text);
  const r = await fetch(`${HEYGEN.serverUrl}/v1/streaming.task`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': HEYGEN.apiKey,
    },
    body: JSON.stringify({ session_id, text: cleanText }),
  });
  const j = await r.json();
  if (!r.ok) {
    console.error('Heygen speak failed:', j);
    log(`⚠️ Avatar speak failed: ${j.message || 'unknown error'}`);
  }
  return j.data;
}

// ==== Init avatar (WebRTC) ====
async function initAvatar() {
  try {
    log('🎬 Creating Heygen session...');
    const res = await fetch(`${HEYGEN.serverUrl}/v1/streaming.new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': HEYGEN.apiKey },
      body: JSON.stringify({
        avatar_name: '',
        voice: {},
        quality: 'high',
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message);
    const { session_id, sdp, ice_servers2 } = data.data;
    sessionInfo = { session_id };

    pc = new RTCPeerConnection({ iceServers: ice_servers2 || [] });
    pc.ontrack = (e) => {
      if (e.streams && e.streams[0]) DOM.avatarVideo.srcObject = e.streams[0];
    };
    pc.onicecandidate = ({ candidate }) => {
      if (candidate)
        fetch(`${HEYGEN.serverUrl}/v1/streaming.ice`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Api-Key': HEYGEN.apiKey },
          body: JSON.stringify({ session_id, candidate }),
        });
    };
    pc.oniceconnectionstatechange = () => log(`ICE State: ${pc.iceConnectionState}`);

    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const local = await pc.createAnswer();
    await pc.setLocalDescription(local);

    await fetch(`${HEYGEN.serverUrl}/v1/streaming.start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': HEYGEN.apiKey },
      body: JSON.stringify({ session_id, sdp: local }),
    });

    // wait for connection
    await new Promise((resolve) => {
      const timer = setInterval(() => {
        if (pc.iceConnectionState === 'connected') {
          clearInterval(timer);
          log('✅ Avatar connected and ready.');
          resolve();
        }
      }, 300);
    });

    await say(session_id, 'Hello! How are you today?');
    log('🗣️ Avatar greeted successfully.');
  } catch (err) {
    console.error(err);
    log(`❌ Avatar init failed: ${err.message}`);
  }
}

// ==== Webcam access ====
async function initUserCam() {
  try {
    userStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 480 },
      audio: true,
    });
    DOM.userVideo.srcObject = userStream;
  } catch {
    log('⚠️ Cannot access webcam.');
  }
}

// ==== Recorder ====
async function recordAnswerFor(seconds) {
  if (!userStream) await initUserCam();
  const rec = new MediaRecorder(userStream, { mimeType: 'video/webm' });
  const chunks = [];

  rec.ondataavailable = (e) => chunks.push(e.data);

  return new Promise((resolve) => {
    rec.onstop = async () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      resolve(blob);
    };
    rec.start();

    let remaining = seconds;
    isRecording = true;
    DOM.recordingBadge.classList.remove('hidden');
    DOM.recordingBadge.textContent = `Recording… ${remaining}s`;

    const iv = setInterval(() => {
      remaining -= 1;
      DOM.recordingBadge.textContent = `Recording… ${remaining}s`;
      if (remaining <= 0) {
        clearInterval(iv);
        isRecording = false;
        DOM.recordingBadge.classList.add('hidden');
        rec.stop();
      }
    }, 1000);
  });
}

// ==== Interview flow (manual "Start Answer" after avatar finishes) ====
async function startInterview() {
  if (!sessionInfo) return log('⚠️ Avatar not ready.');
  const role = candidateProfile?.occupation || DOM.roleSelect.value;
  const username = candidateProfile?.email || DOM.userEmail.value;
  const hourlyRate = candidateProfile?.hourlyRate;
  const candidateName = candidateProfile?.name;
  log(`🎯 Fetching questions for ${role}...`);

  const r = await fetch('/gemini/start-qa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionInfo.session_id, role, hourly_rate: hourlyRate, candidate_name: candidateName }),
  });
  const js = await r.json();
  questions =
    js.questions ||
    [`What are your duties as ${role}?`, `How do you handle problems as ${role}?`];
  qIndex = 0;

  // ask first question after short pause
  setTimeout(() => askNext(role, username), 1200);
}

// async function transcribeSpeech(maxSeconds = 60) {
//   return new Promise((resolve) => {
//     const SpeechRecognition =
//       window.SpeechRecognition || window.webkitSpeechRecognition;
//     const recognition = new SpeechRecognition();
//     recognition.lang = 'en-US';
//     recognition.interimResults = false;
//     recognition.maxAlternatives = 1;

//     let finalTranscript = '';

//     recognition.onresult = (event) => {
//       finalTranscript = event.results[0][0].transcript;
//     };
//     recognition.onend = () => resolve(finalTranscript);

//     recognition.start();

//     setTimeout(() => {
//       recognition.stop();
//     }, maxSeconds * 1000);
//   });
// }


// async function askNext(role, username) {
//   if (qIndex >= questions.length) {
//     // finalize
//     const r = await fetch('/gemini/summary', {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify({ session_id: sessionInfo.session_id }),
//     });
//     const js = await r.json();
//     log(`<b>Summary:</b> ${js.summary}<br><b>Score:</b> ${js.score}/10`);
//     await fetch('/results/save', {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify({
//         username,
//         role,
//         candidate_name: candidateProfile?.name,
//         hourly_rate: candidateProfile?.hourlyRate,
//         address: candidateProfile?.address,
//         questions,
//         answers,
//         score: js.score,
//         summary: js.summary,
//       }),
//     });
//     log('💾 Results saved.');
//     DOM.resultBox.classList.remove('hidden');
//     DOM.resultBox.textContent = `Final Score: ${js.score}/10 — ${js.summary}`;
//     return;
//   }

//   const q = questions[qIndex];
//   log(`<b>Q${qIndex + 1}:</b> ${q}`);
//   await say(sessionInfo.session_id, q); // avatar speaks
//   log('🗣️ Avatar asked question.');

//   // Show Start Answer UI (user clicks when avatar finishes)
//   DOM.answerCta.classList.remove('hidden');
//   DOM.answerHint.textContent = '⏳ You can answer within 1 minute';
//   DOM.startAnswerBtn.disabled = false;
//   DOM.endAnswerBtn.classList.add('hidden');
//   DOM.endAnswerBtn.disabled = true;

//   // One-time handler for this question
//   const onClick = async () => {
//     DOM.startAnswerBtn.disabled = true;
//     DOM.answerHint.textContent = 'Recording your answer…';

//     const blobPromise = startRecording(60);
//     DOM.endAnswerBtn.classList.remove('hidden');
//     DOM.endAnswerBtn.disabled = false;

//     const onEnd = async () => {
//       DOM.endAnswerBtn.disabled = true;
//       await stopRecording();
//     };

//     // Proceed to upload when recording stops (either by timeout or button)
//     blobPromise.then(async (blob) => {
//       DOM.endAnswerBtn.classList.add('hidden');
//       DOM.endAnswerBtn.removeEventListener('click', onEnd);

//       // const filename = `response_q${qIndex + 1}.webm`;
//       // const form = new FormData();
//       // form.append('video', blob, filename);
//       // form.append('question', q);
//       // form.append('role', role);

//       // log('📤 Uploading for transcription & scoring…');
//       // const resp = await fetch('/grade-answer', { method: 'POST', body: form });
//       // const data = await resp.json();

//       // Use browser SpeechRecognition (Web Speech API)
//       log('🎤 Transcribing your answer...');
//       const transcript = await transcribeSpeech(60); // up to 60 seconds

//       log(`📝 Transcript: ${transcript}`);

//       const resp = await fetch('/grade-text', {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/json' },
//         body: JSON.stringify({ question: q, answer: transcript, role }),
//       });
//       const data = await resp.json();

//       if (resp.ok) {
//         const { score, feedback } = data;
//         log(`✅ Score: ${score}/10`);
//         if (feedback) log(`💬 Feedback: ${feedback}`);
//         answers.push(transcript);
//       } else {
//         log(`❌ Grading failed: ${data.error || 'Unknown error'}`);
//       }


//       if (resp.ok) {
//         const { transcript, score, feedback } = data;
//         log(`📝 Transcript: ${transcript}`);
//         log(`✅ Score: ${score}/10`);
//         if (feedback) log(`💬 Feedback: ${feedback}`);
//         answers.push(transcript || `[Video: ${filename}]`);
//       } else {
//         log(`❌ Grading failed: ${data.error || 'Unknown error'}`);
//       }

//       // Hide CTA before moving to next question
//       DOM.answerCta.classList.add('hidden');
//       qIndex++;
//       askNext(role, username);
//     });

//     DOM.endAnswerBtn.addEventListener('click', onEnd, { once: true });
//     DOM.startAnswerBtn.removeEventListener('click', onClick);
//   };

//   // attach handler
//   DOM.startAnswerBtn.removeEventListener('click', onClick);
//   DOM.startAnswerBtn.addEventListener('click', onClick, { once: true });
// }

// ==== UI bindings ====
// --- only speech recognition improved ---
async function transcribeSpeech(maxSeconds = 60) {
  return new Promise((resolve) => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("SpeechRecognition API not supported in this browser.");
      resolve("");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = true; // ✅ get partials faster
    recognition.continuous = false;    // ✅ stop after brief silence

    let transcript = "";
    let timeout;
    let resolved = false;

    recognition.onresult = (event) => {
      const result = event.results[event.results.length - 1];
      const text = result[0].transcript.trim();
      if (text) {
        transcript = text;
        // Reset silence timer when speech continues
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            recognition.stop();
            resolve(transcript.trim());
          }
        }, 1000); // 1s pause threshold = FAST responsiveness
      }
    };

    recognition.onerror = (e) => {
      console.warn("Speech recognition error:", e.error);
      if (!resolved) {
        resolved = true;
        resolve(transcript.trim());
      }
    };

    recognition.onend = () => {
      if (!resolved) {
        resolved = true;
        resolve(transcript.trim());
      }
    };

    recognition.start();

    // Safety cutoff in case recognition hangs
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { recognition.stop(); } catch {}
        resolve(transcript.trim());
      }
    }, maxSeconds * 1000);
  });
}



async function askNext(role, username) {
  if (qIndex >= questions.length) {
    // finalize
    const r = await fetch('/gemini/summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionInfo.session_id }),
    });
    const js = await r.json();
    log(`<b>Summary:</b> ${js.summary}<br><b>Score:</b> ${js.score}/10`);
    await fetch('/results/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        role,
        candidate_name: candidateProfile?.name,
        hourly_rate: candidateProfile?.hourlyRate,
        address: candidateProfile?.address,
        questions,
        answers,
        score: js.score,
        summary: js.summary,
      }),
    });
    log('💾 Results saved.');
    DOM.resultBox.classList.remove('hidden');
    DOM.resultBox.textContent = `Final Score: ${js.score}/10 — ${js.summary}`;
    return;
  }

  const q = questions[qIndex];
  log(`<b>Q${qIndex + 1}:</b> ${q}`);
  await say(sessionInfo.session_id, q); // avatar speaks
  log('🗣️ Avatar asked question.');

  // Show Start Answer UI (user clicks when avatar finishes)
  DOM.answerCta.classList.remove('hidden');
  DOM.answerHint.textContent = '⏳ You can answer within 1 minute';
  DOM.startAnswerBtn.disabled = false;
  DOM.endAnswerBtn.classList.add('hidden');
  DOM.endAnswerBtn.disabled = true;

  // One-time handler for this question
  const onClick = async () => {
    DOM.startAnswerBtn.disabled = true;
    DOM.answerHint.textContent = 'Recording your answer…';

    // 🔹 Start both video recording and speech recognition at the same time
    const listenPromise = transcribeSpeech(60);
    const blobPromise = startRecording(60);

    DOM.endAnswerBtn.classList.remove('hidden');
    DOM.endAnswerBtn.disabled = false;

    const onEnd = async () => {
      DOM.endAnswerBtn.disabled = true;
      await stopRecording();
      log('⏹️ Recording stopped manually.');
    };

    DOM.endAnswerBtn.addEventListener('click', onEnd, { once: true });

    // Wait for both to complete
    const [blob, transcript] = await Promise.all([blobPromise, listenPromise]);

    DOM.endAnswerBtn.classList.add('hidden');
    DOM.endAnswerBtn.removeEventListener('click', onEnd);

    if (!transcript || transcript.trim().length === 0) {
      log('⚠️ No speech detected, moving to next question.');
      answers.push('[No response]');
      DOM.answerCta.classList.add('hidden');
      qIndex++;
      askNext(role, username);
      return;
    }

    log(`📝 Transcript: ${transcript}`);
    DOM.answerHint.textContent = 'Evaluating your answer...';

    // === Send text to Gemini grading endpoint ===
    const resp = await fetch('/grade-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q, answer: transcript, role }),
    });

    const data = await resp.json();

    if (resp.ok) {
      const { score, feedback } = data;
      log(`✅ Score: ${score}/10`);
      if (feedback) log(`💬 Feedback: ${feedback}`);
      answers.push(transcript);
    } else {
      log(`❌ Grading failed: ${data.error || 'Unknown error'}`);
    }

    // Hide CTA before moving to next question
    DOM.answerCta.classList.add('hidden');
    qIndex++;
    askNext(role, username);
  };

  // attach handler
  DOM.startAnswerBtn.removeEventListener('click', onClick);
  DOM.startAnswerBtn.addEventListener('click', onClick, { once: true });
}




DOM.startBtn.addEventListener('click', startInterview);
DOM.closeBtn.addEventListener('click', () => {
  if (pc) pc.close();
  log('🔚 Session closed.');
});

// ==== Boot ====
window.addEventListener('DOMContentLoaded', async () => {
  await initAvatar();
  await initUserCam();
  loadCandidateProfile();
});
