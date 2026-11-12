const pairToken = location.hash.slice(1);
history.replaceState(null, '', location.pathname);
let phoneMode = 'xtream';
const phoneStatus = document.querySelector('#phoneStatus');
const phoneForm = document.querySelector('#phonePairForm');

document.querySelectorAll('.mode').forEach(button => button.addEventListener('click', () => {
  phoneMode = button.dataset.mode;
  document.querySelectorAll('.mode').forEach(item => item.classList.toggle('active', item === button));
  document.querySelector('#phoneXtreamFields').hidden = phoneMode !== 'xtream';
  document.querySelector('#phoneM3uFields').hidden = phoneMode !== 'm3u';
  document.querySelector('#phoneServerUrl').required = phoneMode === 'xtream';
  document.querySelector('#phoneUsername').required = phoneMode === 'xtream';
  document.querySelector('#phonePassword').required = phoneMode === 'xtream';
  document.querySelector('#phoneM3uUrl').required = phoneMode === 'm3u';
}));

phoneForm.addEventListener('submit', async event => {
  event.preventDefault();
  const button = document.querySelector('#sendPair');
  button.disabled = true;
  button.textContent = 'CONNECTING…';
  phoneStatus.textContent = '';
  const profile = phoneMode === 'xtream'
    ? { type: 'xtream', base: document.querySelector('#phoneServerUrl').value.trim().replace(/\/+$/, ''), username: document.querySelector('#phoneUsername').value.trim(), password: document.querySelector('#phonePassword').value }
    : { type: 'm3u', playlist: document.querySelector('#phoneM3uUrl').value.trim() };
  try {
    const response = await fetch('/api/pair/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: pairToken, profile })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not pair this TV.');
    phoneForm.querySelectorAll('input').forEach(input => input.value = '');
    phoneStatus.textContent = 'Done! Your TV is connecting now. You can close this page.';
    button.textContent = 'SENT TO TV';
  } catch (error) {
    phoneStatus.textContent = error.message;
    button.disabled = false;
    button.textContent = 'TRY AGAIN';
  }
});

if (!pairToken || pairToken.length < 40) {
  phoneForm.innerHTML = '<h1>Pairing link expired</h1><p class="muted">Return to Top Tier Player and scan a new QR code.</p>';
}
