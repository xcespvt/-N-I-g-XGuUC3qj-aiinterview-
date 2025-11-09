'use strict';

const DOM = {
  form: document.querySelector('#loginForm'),
  loginId: document.querySelector('#loginId'),
  password: document.querySelector('#password'),
  status: document.querySelector('#statusMsg'),
  loginBtn: document.querySelector('#loginBtn'),
};

function setStatus(msg, type = 'info') {
  DOM.status.textContent = msg || '';
  DOM.status.style.borderColor = type === 'error' ? '#ef4444' : type === 'success' ? '#22c55e' : 'rgba(255,255,255,0.2)';
}

async function fetchUsers() {
  const r = await fetch('users.json', { cache: 'no-store' });
  if (!r.ok) throw new Error('Failed to load users.json');
  return r.json();
}

DOM.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  setStatus('Authenticating…');
  DOM.loginBtn.disabled = true;

  try {
    const id = (DOM.loginId.value || '').trim();
    const pw = DOM.password.value || '';
    const users = await fetchUsers();
    const user = users.find((u) => u.id.toLowerCase() === id.toLowerCase());

    if (!user) {
      setStatus('Unknown login ID.', 'error');
      return;
    }
    if (user.password !== pw) {
      setStatus('Incorrect password.', 'error');
      return;
    }

    // POC: store the authenticated user in sessionStorage
    sessionStorage.setItem('authUser', JSON.stringify({ id: user.id, name: user.name, gender: user.gender }));
    setStatus(`Login successful. Welcome, ${user.name}! Redirecting…`, 'success');
    setTimeout(() => {
      window.location.href = 'profile.html';
    }, 500);
  } catch (err) {
    console.error('Login error:', err);
    setStatus('Login failed. Please try again.', 'error');
  } finally {
    DOM.loginBtn.disabled = false;
  }
});