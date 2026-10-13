const SUPABASE_URL = "https://dxicbitnnesjsqzxisea.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4aWNiaXRubmVzanNxenhpc2VhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0MTQzMTMsImV4cCI6MjEwNjk5MDMxM30.0xUXIa0Bby7xpJAF_N3y-n_H3SPwVlUBb9m630AFPtw";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  const activeUser = localStorage.getItem('active_user_id');
  if (activeUser) {
    window.location.href = 'album.html';
  }
});

function switchAuthMode(mode) {
  if (mode === 'register') {
    document.getElementById('loginForm').classList.add('hidden');
    document.getElementById('registerForm').classList.remove('hidden');
    document.getElementById('authTitle').innerText = 'REGISTRO DE USUARIO';
  } else {
    document.getElementById('registerForm').classList.add('hidden');
    document.getElementById('loginForm').classList.remove('hidden');
    document.getElementById('authTitle').innerText = 'ACCESO AL SISTEMA';
  }
}

async function handleRegister(e) {
  e.preventDefault();
  try {
    const username = document.getElementById('regUsername').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const pass = document.getElementById('regPassword').value.trim();
    const banco = document.getElementById('regBanco').value.trim();
    const cedula = document.getElementById('regCedula').value.trim();
    const telefono = document.getElementById('regTelefono').value.trim();
    const userId = 'USR-' + username.toUpperCase();

    const { error } = await supabaseClient.from('usuarios').insert([{
      id: userId, username: username, password_hash: pass, gmail: email,
      banco: banco, cedula: cedula, telefono: telefono, cantidad_barajitas: 0, saldo_bs: 0
    }]);

    if (error) { alert('Error en registro: ' + error.message); return; }
    alert('¡Registro exitoso! Inicia sesión ahora.');
    switchAuthMode('login');
  } catch (err) { console.error(err); }
}

async function handleLogin(e) {
  e.preventDefault();
  try {
    const username = document.getElementById('loginUsername').value.trim();
    const pass = document.getElementById('loginPassword').value.trim();

    const { data, error } = await supabaseClient
      .from('usuarios').select('*').eq('username', username).maybeSingle();

    if (error || !data || data.password_hash !== pass) {
      alert('Usuario o contraseña incorrectos.');
      return;
    }

    localStorage.setItem('active_user_id', data.id);
    window.location.href = 'album.html';
  } catch (err) { console.error(err); }
}

function openRecoveryModal() { document.getElementById('recoveryModal').classList.remove('hidden'); }
function closeRecoveryModal() { document.getElementById('recoveryModal').classList.add('hidden'); }

async function verifyRecoveryData() {
  const u = document.getElementById('recUsername').value.trim();
  const e = document.getElementById('recEmail').value.trim();
  const t = document.getElementById('recTelefono').value.trim();
  
  const { data, error } = await supabaseClient.from('usuarios').select('*').eq('username', u).maybeSingle();
  if (error || !data) { alert('Usuario no existe.'); return; }
  
  if (data.gmail.toLowerCase() === e.toLowerCase() && data.telefono.trim() === t.trim()) {
    document.getElementById('recoveryStep1').classList.add('hidden');
    document.getElementById('recoveryStep2').classList.remove('hidden');
  } else { alert('Datos no coinciden.'); }
}

function sendChatMessage() {
  const input = document.getElementById('chatInput');
  const box = document.getElementById('telegramChatBox');
  const val = input.value.trim();
  if (!val) return;
  box.innerHTML += `<div class="text-right text-blue-300"><b>Tú:</b> ${val}</div>`;
  input.value = '';
  setTimeout(() => {
    box.innerHTML += `<div class="bg-purple-900/40 p-2 rounded text-purple-200">🤖 <b>Bot Telegram:</b> Solicitud procesada. Código #TG-SECURE-99.</div>`;
    box.scrollTop = box.scrollHeight;
  }, 1000);
}