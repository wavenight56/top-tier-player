const pairDialog = document.querySelector('#pairDialog');
const pairButton = document.querySelector('#pairButton');
const pairStatus = document.querySelector('#pairStatus');
const pairApiBase = location.hostname === 'appassets.androidplatform.net' ? 'https://top-tier-player.onrender.com' : '';
let pairGeneration = 0;

async function startPhonePairing() {
  const generation = ++pairGeneration;
  pairButton.disabled = true;
  pairStatus.textContent = 'Preparing secure pairing…';
  document.querySelector('#pairQr').removeAttribute('src');
  document.querySelector('#restartPair').hidden = true;
  pairDialog.showModal();
  try {
    const response = await fetch(pairApiBase + '/api/pair/new', { cache: 'no-store' });
    const session = await response.json();
    if (!response.ok) throw new Error(session.error || 'Could not start phone pairing.');
    document.querySelector('#pairQr').src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(session.qrSvg);
    pairStatus.textContent = 'Scan with your phone camera, then enter your provider details.';

    while (generation === pairGeneration && Date.now() < session.expiresAt) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      if (generation !== pairGeneration || !pairDialog.open) break;
      const poll = await fetch(pairApiBase + '/api/pair/poll', {
        cache: 'no-store',
        headers: { 'X-Pair-Token': session.token }
      });
      const result = await poll.json();
      if (result.status === 'expired') throw new Error('This QR code expired. Make a new one and scan again.');
      if (result.status !== 'ready') continue;

      const profile = result.profile;
      if (profile.type === 'xtream') {
        document.querySelector('.mode[data-mode="xtream"]').click();
        document.querySelector('#serverUrl').value = profile.base;
        document.querySelector('#username').value = profile.username;
        document.querySelector('#password').value = profile.password;
      } else {
        document.querySelector('.mode[data-mode="m3u"]').click();
        document.querySelector('#m3uUrl').value = profile.playlist;
      }
      pairStatus.textContent = 'Details received. Connecting to your provider…';
      pairDialog.close();
      document.querySelector('#loginForm').requestSubmit();
      return;
    }
    if (generation === pairGeneration && pairDialog.open) throw new Error('This QR code expired. Make a new one and scan again.');
  } catch (error) {
    if (generation === pairGeneration && pairDialog.open) {
      pairStatus.textContent = error.message || 'Could not pair this TV.';
      document.querySelector('#restartPair').hidden = false;
    }
  } finally {
    if (generation === pairGeneration) pairButton.disabled = false;
  }
}

pairButton.addEventListener('click', startPhonePairing);
document.querySelector('#restartPair').addEventListener('click', startPhonePairing);
document.querySelector('#closePair').addEventListener('click', () => {
  pairGeneration++;
  pairDialog.close();
  pairButton.disabled = false;
});
pairDialog.addEventListener('cancel', () => { pairGeneration++; pairButton.disabled = false; });
