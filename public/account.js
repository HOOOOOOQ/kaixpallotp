let mode = 'login';
const form = document.querySelector('#auth-form');
const message = document.querySelector('#message');
function setMode(next) {
  mode = next; message.textContent = '';
  document.querySelector('#login-tab').setAttribute('aria-selected', String(mode === 'login'));
  document.querySelector('#register-tab').setAttribute('aria-selected', String(mode === 'register'));
  document.querySelector('#form-title').textContent = mode === 'login' ? 'Welcome back.' : 'Let’s get started.';
  document.querySelector('#form-description').textContent = mode === 'login' ? 'Sign in to access your workspace.' : 'Create an account for your workspace.';
  document.querySelector('#submit').textContent = mode === 'login' ? 'Sign in →' : 'Create account →';
  document.querySelector('#password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
}
document.querySelector('#login-tab').addEventListener('click', () => setMode('login'));
document.querySelector('#register-tab').addEventListener('click', () => setMode('register'));
form.addEventListener('submit', async event => {
  event.preventDefault(); if (!form.reportValidity()) return;
  const button = document.querySelector('#submit'); button.disabled = true; button.textContent = 'Please wait…'; message.textContent = '';
  try {
    const response = await fetch('/api/account/' + mode, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email:document.querySelector('#email').value, password:document.querySelector('#password').value})});
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Unable to continue.');
    window.location.assign('/dashboard');
  } catch (error) { message.textContent = error.message || 'Connection failed. Please try again.'; }
  finally { button.disabled = false; button.textContent = mode === 'login' ? 'Sign in →' : 'Create account →'; }
});
