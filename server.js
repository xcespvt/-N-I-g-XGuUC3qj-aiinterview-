
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const upload = multer();
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(express.json());

// Serve login page by default at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

// Static assets (including index.html) after explicit root route
app.use(express.static(path.join(__dirname, '.')));


const apikeys = [
  'AIzaSyDK_TYCAjIhf4QIFc3v0xFJj5gaaopm2PQ',
  'AIzaSyAdq00ReOIjazjB2DBMNKNcmO0nXb6b550',
  'AIzaSyArwTWrrMVzpJxqmsuZcnE0eSBCdysGOUo'
]

function getRandomKey() {
  const idx = Math.floor(Math.random() * apikeys.length);
  return apikeys[idx];
}
  const genAI = new GoogleGenerativeAI(getRandomKey());
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });

const sessions = new Map();

function safeJSON(txt) {
  try { return JSON.parse(txt); }
  catch {
    const m = txt.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (m) try { return JSON.parse(m[0]); } catch {}
  }
  return null;
}

async function gText(prompt) {
  const r = await model.generateContent(prompt);
  return r.response.text();
}

function base64(buf) {
  return Buffer.from(buf).toString('base64');
}

// ========== Generate 5–10 questions automatically ==========
app.post('/gemini/start-qa', async (req, res) => {
  const { session_id, role, hourly_rate, candidate_name } = req.body;
  if (!session_id) return res.status(400).json({ error: 'Missing session_id' });

  const rateInfo = hourly_rate ? ` The candidate's hourly rate is €${hourly_rate}/h.` : '';
  const nameInfo = candidate_name ? ` The candidate's name is ${candidate_name}.` : '';
  const p = `Generate between 5 and 10 concise, varied interview questions for a ${role} working in a film production house.${nameInfo}${rateInfo}
  These should test practical experience, creative decision-making, teamwork, and problem-solving.
  Return a JSON array of strings only.`;
  const txt = await gText(p);
  const js = safeJSON(txt);
  const qs = Array.isArray(js) && js.length ? js : [
    `What are your key responsibilities as a ${role}?`,
    `How do you approach challenges on set as a ${role}?`,
    `Describe a situation where your lighting setup changed the mood of a scene.`,
    `How do you ensure safety and efficiency when handling lighting equipment?`,
    `What’s one technical innovation you’ve adopted recently in your lighting work?`,
  ];
  sessions.set(session_id, { role, questions: qs, answers: [], scores: [], hourly_rate, candidate_name });
  res.json({ questions: qs });
});

// ========== Record answer + transcribe + score ==========
app.post('/grade-answer', upload.single('video'), async (req, res) => {
  try {
    const { question, role, session_id } = req.body;
    if (!req.file) return res.status(400).json({ error: 'Missing video file' });

    // Do NOT persist the uploaded media to disk; use buffer directly

    const audioB64 = base64(req.file.buffer);
    const transcribePrompt = [
      {
        text: "Transcribe this spoken answer clearly into English text only. Remove fillers and background noise."
      },
      {
        inlineData: {
          data: audioB64,
          mimeType: req.file.mimetype || 'audio/webm'
        }
      }
    ];

    const tr = await model.generateContent(transcribePrompt);
    const transcript = (tr.response.text() || '').trim();

    const scorePrompt = `Question: ${question}\nRole: ${role}\nAnswer: """${transcript}"""\n
      Evaluate the candidate’s relevance, clarity, and understanding of ${role} duties.
      Give a JSON: {"score": number (0-10), "feedback": "1 sentence feedback"}.`;
    const scoreTxt = await gText(scorePrompt);
    const scored = safeJSON(scoreTxt) || { score: 6, feedback: 'Default score.' };

    if (session_id && sessions.has(session_id)) {
      const sess = sessions.get(session_id);
      sess.answers.push(transcript);
      sess.scores.push(scored.score);
    }

    res.json({
      ok: true,
      transcript,
      score: scored.score,
      feedback: scored.feedback
    });
  } catch (err) {
    console.error('grade-answer failed:', err);
    res.status(500).json({ error: 'Failed to process answer' });
  }
});

// ========== Final summary + average score ==========
app.post('/gemini/summary', async (req, res) => {
  try {
    const { session_id } = req.body;
    const sess = sessions.get(session_id) || {};
    const qa = (sess.questions || [])
      .map((q, i) => `Q: ${q}\nA: ${sess.answers?.[i] || '[no response]'}`)
      .join('\n');

    const p = `You are evaluating an interview for a ${sess.role || 'candidate'} role.
      Summarize their performance, mention strengths/weaknesses, and compute average score from all answers (0–10 scale).
      Return pure JSON: {"summary": "short summary paragraph", "score": number}. 
      Interview:\n${qa}`;

    const t = await gText(p);
    const js = safeJSON(t);
    if (js?.score === undefined && sess.scores?.length)
      js.score = Math.round(sess.scores.reduce((a, b) => a + b, 0) / sess.scores.length);
    res.json(js || { summary: 'Fallback summary', score: 6 });
  } catch (err) {
    console.error('summary failed:', err);
    res.status(500).json({ error: 'Failed to summarize interview' });
  }
});

// ========== Serve ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on http://0.0.0.0:${PORT}`));
