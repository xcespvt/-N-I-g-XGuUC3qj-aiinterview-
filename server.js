require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const upload = multer();
const fetch = require("node-fetch");

const app = express();
app.use(express.json());

// Serve login page
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "login.html")));
app.use(express.static(path.join(__dirname, ".")));

const OPENROUTER_KEYS = process.env.OPENROUTER_API_KEYS || "";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

function safeJSON(txt) {
  try {
    return JSON.parse(txt);
  } catch {
    const m = txt.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (m)
      try {
        return JSON.parse(m[0]);
      } catch {}
  }
  return null;
}

// === Helper to call OpenRouter ===
async function callOpenRouter(prompt) {
  const body = {
    model: "deepseek/deepseek-r1-0528-qwen3-8b:free",
    messages: [{ role: "user", content: prompt }],
  };
  const r = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://aiavatartest.hnsolutions.in",
      "X-Title": "AI Avatar Interview",
    },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  return (
    data?.choices?.[0]?.message?.content?.trim() ||
    JSON.stringify(data, null, 2)
  );
}

const sessions = new Map();

// ========== Generate 5–10 questions ==========
app.post("/gemini/start-qa", async (req, res) => {
  const { session_id, role, hourly_rate, candidate_name } = req.body;
  if (!session_id) return res.status(400).json({ error: "Missing session_id" });

  const rateInfo = hourly_rate ? ` The candidate's hourly rate is €${hourly_rate}/h.` : "";
  const nameInfo = candidate_name ? ` The candidate's name is ${candidate_name}.` : "";
  const prompt = `Generate between 5 and 10 concise, varied interview questions for a ${role} working in a film production house.${nameInfo}${rateInfo}
  These should test practical experience, creative decision-making, teamwork, and problem-solving.
  Return a JSON array of strings only.`;

  const txt = await callOpenRouter(prompt);
  const js = safeJSON(txt);
  const qs = Array.isArray(js) && js.length
    ? js
    : [
        `What are your key responsibilities as a ${role}?`,
        `How do you approach challenges on set as a ${role}?`,
        `Describe a situation where your lighting setup changed the mood of a scene.`,
        `How do you ensure safety and efficiency when handling lighting equipment?`,
        `What’s one technical innovation you’ve adopted recently in your lighting work?`,
      ];

  sessions.set(session_id, { role, questions: qs, answers: [], scores: [], hourly_rate, candidate_name });
  res.json({ questions: qs });
});

// ========== Grade text answer ==========
// app.post("/grade-text", async (req, res) => {
//   const { question, answer, role } = req.body;
//   try {
//     const prompt = `
// You are an AI interviewer evaluating answers for the role of ${role}.
// Question: ${question}
// Candidate Answer: ${answer}
// Return JSON like {"score": number, "feedback": "short feedback"} (score 0–10).`;

//     const txt = await callOpenRouter(prompt);
//     const json = safeJSON(txt) || { score: 5, feedback: "Default feedback" };
//     res.json(json);
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });
app.post("/grade-text", async (req, res) => {
  const { question, answer, role } = req.body;
  try {
    const prompt = `
You are an AI interviewer evaluating a candidate for the role of ${role}.
Question: ${question}
Answer: ${answer}
Provide only a short JSON: {"score": number, "feedback": "short constructive feedback"} (score 1–10).`;

    const txt = await callOpenRouter(prompt);
    let json = safeJSON(txt);

    // ✅ If model returns non-JSON text like "Score: 8/10"
    if (!json) {
      const m = txt.match(/(\d{1,2})(?:\/10)?/);
      const num = m ? Math.min(10, Math.max(0, parseInt(m[1]))) : 5;
      json = { score: num, feedback: txt.replace(/[\n\r]/g, " ").slice(0, 150) };
    }

    // ✅ Always ensure numeric score + feedback
    if (typeof json.score !== "number") json.score = 5;
    if (!json.feedback) json.feedback = "Good response.";

    res.json(json);
  } catch (err) {
    console.error("grade-text error:", err);
    res.status(500).json({ error: "Grading failed: " + err.message });
  }
});


// ========== Summary ==========
app.post("/gemini/summary", async (req, res) => {
  try {
    const { session_id } = req.body;
    const sess = sessions.get(session_id) || {};
    const qa = (sess.questions || [])
      .map((q, i) => `Q: ${q}\nA: ${sess.answers?.[i] || "[no response]"}`)
      .join("\n");

    const prompt = `You are evaluating an interview for a ${sess.role || "candidate"} role.
Summarize their performance, mention strengths/weaknesses, and compute average score (0–10).
Return JSON: {"summary": "short summary", "score": number}.
Interview:\n${qa}`;

    const txt = await callOpenRouter(prompt);
    const js = safeJSON(txt);
    if (js?.score === undefined && sess.scores?.length)
      js.score = Math.round(sess.scores.reduce((a, b) => a + b, 0) / sess.scores.length);
    res.json(js || { summary: "Fallback summary", score: 6 });
  } catch (err) {
    res.status(500).json({ error: "Failed to summarize interview" });
  }
});

// ========== Start Server ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on http://0.0.0.0:${PORT}`));
