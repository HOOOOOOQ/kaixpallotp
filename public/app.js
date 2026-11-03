const labels = { available: 'Available', unavailable: 'Unavailable', not_configured: 'Not configured', not_checked: 'Not checked' };
async function refreshStatus() {
  const button = document.querySelector('#refresh');
  button.disabled = true; button.textContent = 'Checking…';
  try {
    const response = await fetch('/api/health', { cache: 'no-store' });
    if (!response.ok) throw new Error('Unavailable');
    const data = await response.json();
    for (const [key, id] of [['application','app-status'], ['database','db-status'], ['provider','provider-status']]) { const el = document.getElementById(id); el.textContent = labels[data[key]] || 'Unknown'; el.parentElement.querySelector('.status-dot').classList.toggle('neutral', data[key] !== 'available'); }
  } catch {
    document.getElementById('app-status').textContent = 'Unavailable';
    document.querySelector('#app-status').parentElement.querySelector('.status-dot').classList.add('neutral');
    document.getElementById('db-status').textContent = 'Unknown';
    document.getElementById('provider-status').textContent = 'Unknown';
  } finally { button.disabled = false; button.textContent = 'Refresh status ↻'; }
}
document.querySelector('#refresh').addEventListener('click', refreshStatus);
refreshStatus();

const menu = document.querySelector('.menu-toggle');
const navigation = document.querySelector('#main-navigation');
if (menu && navigation) {
  const setMenu = open => {
    menu.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    navigation.classList.toggle('is-open', open);
  };
  menu.addEventListener('click', () => setMenu(menu.getAttribute('aria-expanded') !== 'true'));
  navigation.addEventListener('click', event => { if (event.target.closest('a')) setMenu(false); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') setMenu(false); });
  window.addEventListener('resize', () => { if (window.innerWidth > 700) setMenu(false); });
}
