const API_URL = "https://album-digital-1.onrender.com";

document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
});

function switchAuthMode(mode) {
  // Limpiar errores visuales al cambiar de modo
  limpiarErrorRegistro();
  
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

// Función auxiliar para mostrar errores debajo del input de usuario en el registro
function mostrarErrorRegistro(mensaje) {
  let errorDiv = document.getElementById('regErrorMsg');
  if (!errorDiv) {
    // Si no existe el elemento en el HTML, lo creamos dinámicamente debajo del input de usuario
    const userInput = document.getElementById('regUsername');
    if (userInput && userInput.parentNode) {
      errorDiv = document.createElement('p');
      errorDiv.id = 'regErrorMsg';
      errorDiv.className = 'text-red-400 text-xs mt-1 font-medium transition-all';
      userInput.parentNode.appendChild(errorDiv);
    }
  }
  if (errorDiv) {
    errorDiv.innerText = mensaje;
  }
}

function limpiarErrorRegistro() {
  const errorDiv = document.getElementById('regErrorMsg');
  if (errorDiv) {
    errorDiv.innerText = '';
  }
}

async function handleRegister(e) {
  e.preventDefault();
  limpiarErrorRegistro();

  try {
    const username = document.getElementById('regUsername').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const pass = document.getElementById('regPassword').value.trim();
    const banco = document.getElementById('regBanco').value.trim();
    const cedula = document.getElementById('regCedula').value.trim();
    const telefono = document.getElementById('regTelefono').value.trim();

    const res = await fetch(`${API_URL}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password: pass, banco, cedula, telefono })
    });

    const data = await res.json();
    if (!res.ok) {
      // 🔴 AQUÍ MOSTRAMOS EL ERROR VISUALMENTE EN LA INTERFAZ EN LUGAR DE UN ALERT
      mostrarErrorRegistro(data.error || 'No se pudo completar el registro.');
      return;
    }

    alert('¡Registro exitoso! Inicia sesión ahora.');
    switchAuthMode('login');
  } catch (err) {
    console.error('Error de red en registro:', err);
    mostrarErrorRegistro('Error de conexión con el servidor.');
  }
}

async function handleLogin(e) {
  e.preventDefault();
  try {
    const username = document.getElementById('loginUsername').value.trim();
    const pass = document.getElementById('loginPassword').value.trim();

    const res = await fetch(`${API_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: pass })
    });

    const data = await res.json();

    if (res.status === 403 || data.bloqueado) {
      alert("Advertencia de Seguridad: Tu cuenta ha sido bloqueada debido a intentos de acceso no autorizado a áreas restringidas.");
      return;
    }

    if (!res.ok || !data.success) {
      alert('Usuario o contraseña incorrectos.');
      return;
    }

    // 1. Guardamos la sesión en el navegador
    localStorage.setItem('active_user_id', data.user_id);

    // 2. 🟢 ENVIAMOS LA NOTIFICACIÓN A TELEGRAM AUTOMÁTICAMENTE
    await fetch(`${API_URL}/api/notificar-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario_id: data.user_id })
    });

    // 3. Redirigimos al álbum
    window.location.href = 'album.html';
  } catch (err) {
    console.error('Error de red en login:', err);
  }
}

function openRecoveryModal() { document.getElementById('recoveryModal').classList.remove('hidden'); }
function closeRecoveryModal() { document.getElementById('recoveryModal').classList.add('hidden'); }

async function verifyRecoveryData() {
  const u = document.getElementById('recUsername').value.trim();
  const e = document.getElementById('recEmail').value.trim();
  const c = document.getElementById('recCedula').value.trim();
  const t = document.getElementById('recTelefono').value.trim();
  const errorMsg = document.getElementById('recErrorMsg');

  if (errorMsg) errorMsg.innerText = '';

  if (!u || !e || !c || !t) {
    if (errorMsg) errorMsg.innerText = 'Por favor completa los 4 campos requeridos.';
    return;
  }
  
  try {
    const res = await fetch(`${API_URL}/api/solicitar-recuperacion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, email: e, cedula: c, telefono: t })
    });
    const data = await res.json();

    if (res.ok && data.success) {
      document.getElementById('recoveryStep1').classList.add('hidden');
      document.getElementById('recoveryStep2').classList.remove('hidden');
    } else {
      if (errorMsg) {
        errorMsg.innerText = data.message || 'No se pudo enviar la solicitud.';
      }
    }
  } catch (err) {
    console.error('Error en recuperación:', err);
    if (errorMsg) errorMsg.innerText = 'Error de conexión con el servidor.';
  }
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
function openTermsModal() {
  document.getElementById('termsModal').classList.remove('hidden');
}

function closeTermsModal() {
  document.getElementById('termsModal').classList.add('hidden');
}
