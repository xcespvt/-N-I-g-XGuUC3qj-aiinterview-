'use strict';

const DOM = {
  form: document.querySelector('#profileForm'),
  name: document.querySelector('#name'),
  email: document.querySelector('#email'),
  address: document.querySelector('#address'),
  location: document.querySelector('#location'),
  occupation: document.querySelector('#occupation'),
  hourlyRate: document.querySelector('#hourlyRate'),
  status: document.querySelector('#statusMsg'),
  saveBtn: document.querySelector('#saveProfileBtn'),
};

function setStatus(msg, type = 'info') {
  DOM.status.textContent = msg || '';
  DOM.status.style.borderColor = type === 'error' ? '#ef4444' : type === 'success' ? '#22c55e' : 'rgba(255,255,255,0.2)';
}

DOM.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  DOM.saveBtn.disabled = true;
  setStatus('Saving profile…');

  try {
    const profile = {
      name: DOM.name.value.trim(),
      email: DOM.email.value.trim(),
      address: DOM.address.value.trim(),
      location: DOM.location.value.trim(),
      occupation: DOM.occupation.value.trim(),
      hourlyRate: parseFloat(DOM.hourlyRate.value),
    };

    if (!profile.name || !profile.email || !profile.address || !profile.location || !profile.occupation || isNaN(profile.hourlyRate)) {
      setStatus('Please fill all fields correctly.', 'error');
      return;
    }

    sessionStorage.setItem('candidateProfile', JSON.stringify(profile));
    setStatus('Profile saved. Redirecting to interview…', 'success');
    setTimeout(() => { window.location.href = 'index.html'; }, 600);
  } catch (err) {
    console.error('Profile save error:', err);
    setStatus('Failed to save profile. Please try again.', 'error');
  } finally {
    DOM.saveBtn.disabled = false;
  }
});