const API_URL = "https://album-digital-1.onrender.com";

// ==========================================
// CAPTURA DEL PARÁMETRO ?REF= AL CARGAR LA PÁGINA
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const refCode = urlParams.get('ref');

  if (refCode) {
    // 1. Guardar en sessionStorage para el registro
    sessionStorage.setItem('codigo_referido_invitacion', refCode);
    console.log("🔗 Código de referido detectado:", refCode);

    // 2. Si tu login y registro están en la misma página por pestañas o modales, 
    // forzamos a mostrar el formulario de registro automáticamente:
    const registerTabBtn = document.getElementById('btnTabRegister'); 
    const registerForm = document.getElementById('registerForm');
    const loginForm = document.getElementById('loginForm');

    if (registerForm && loginForm) {
      loginForm.classList.add('hidden');
      registerForm.classList.remove('hidden');
    }

    // 3. Autorellenar el campo del código de referido si existe en tu formulario
    setTimeout(() => {
      const inputRefField = document.getElementById('regCodigoReferido') || document.getElementById('refInput');
      if (inputRefField) {
        inputRefField.value = refCode;
        inputRefField.readOnly = true; 
      }
    }, 300);
  }
});

// ==========================================
// ALTERNAR ENTRE LOGIN Y REGISTRO
// ==========================================
function switchAuthMode(mode) {
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const authTitle = document.getElementById('authTitle');

  if (mode === 'register') {
    loginForm.classList.add('hidden');
    registerForm.classList.remove('hidden');
    if (authTitle) authTitle.innerText = "REGISTRO DE USUARIO";
  } else {
    registerForm.classList.add('hidden');
    loginForm.classList.remove('hidden');
    if (authTitle) authTitle.innerText = "ACCESO AL SISTEMA";
  }
}

// ==========================================
// MANEJADOR DE INICIO DE SESIÓN
// ==========================================
async function handleLogin(event) {
  event.preventDefault();

  const usernameInput = document.getElementById('loginUsername');
  const passwordInput = document.getElementById('loginPassword');
  const submitBtn = event.submitter || document.querySelector('#loginForm button[type="submit"]');

  if (!usernameInput || !passwordInput) return;

  const username = usernameInput.value.trim();
  const password = passwordInput.value.trim();

  if (!username || !password) {
    alert("Por favor completa todos los campos.");
    return;
  }

  try {
    if (submitBtn) submitBtn.disabled = true;

    const res = await fetch(`${API_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();

    if (res.ok && data.success) {
      localStorage.setItem('active_user_id', data.user_id);
      if (data.session_token) {
        localStorage.setItem('session_token', data.session_token);
        
        // Sello de tiempo de expiración (1 hora)
        const now = new Date().getTime();
        const tokenData = {
          token: data.session_token,
          expiry: now + (60 * 60 * 1000)
        };
        localStorage.setItem('session_token_data', JSON.stringify(tokenData));
      }

      // Notificar login al backend de forma asíncrona
      fetch(`${API_URL}/api/notificar-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario_id: data.user_id })
      }).catch(err => console.error("Error notificando login:", err));

      window.location.href = 'album.html';
    } else {
      if (data.bloqueado) {
        alert("Tu cuenta se encuentra bloqueada por seguridad.");
      } else {
        alert(data.message || "Usuario o contraseña incorrectos.");
      }
      if (submitBtn) submitBtn.disabled = false;
    }
  } catch (err) {
    console.error("Error en el inicio de sesión:", err);
    alert("Error de conexión con el servidor backend.");
    if (submitBtn) submitBtn.disabled = false;
  }
} // 👈 Llave de cierre agregada correctamente

// ==========================================
// MANEJADOR DE REGISTRO
// ==========================================
async function handleRegister(event) {
  event.preventDefault();

  const username = document.getElementById('regUsername').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value.trim();
  const banco = document.getElementById('regBanco').value.trim();
  const cedula = document.getElementById('regCedula').value.trim();
  const telefono = document.getElementById('regTelefono').value.trim();
  const errorMsgEl = document.getElementById('regErrorMsg');
  const submitBtn = event.submitter || document.querySelector('#registerForm button[type="submit"]');

  if (errorMsgEl) errorMsgEl.innerText = "";

  const codigoReferidoInvitacion = sessionStorage.getItem('codigo_referido_invitacion') || "";

  try {
    if (submitBtn) submitBtn.disabled = true;

    const res = await fetch(`${API_URL}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        email,
        password,
        banco,
        cedula,
        telefono,
        ref: codigoReferidoInvitacion
      })
    });

    const data = await res.json();

    if (res.ok && data.success) {
      localStorage.setItem('active_user_id', data.user_id);
      if (data.session_token) {
        localStorage.setItem('session_token', data.session_token);
        
        // Sello de tiempo de expiración (1 hora) al registrarse
        const now = new Date().getTime();
        const tokenData = {
          token: data.session_token,
          expiry: now + (60 * 60 * 1000)
        };
        localStorage.setItem('session_token_data', JSON.stringify(tokenData));
      }
      window.location.href = 'album.html';
    } else {
      if (errorMsgEl) {
        errorMsgEl.innerText = data.error || "Error al registrar el usuario.";
      } else {
        alert(data.error || "Error al registrar el usuario.");
      }
      if (submitBtn) submitBtn.disabled = false;
    }
  } catch (err) {
    console.error("Error en el registro:", err);
    if (errorMsgEl) {
      errorMsgEl.innerText = "Error de conexión con el servidor.";
    } else {
      alert("Error de conexión con el servidor.");
    }
    if (submitBtn) submitBtn.disabled = false;
  }
}

// ==========================================
// MODAL DE RECUPERACIÓN DE CONTRASEÑA
// ==========================================
function openRecoveryModal() {
  const modal = document.getElementById('recoveryModal');
  if (modal) {
    modal.classList.remove('hidden');
    document.getElementById('recoveryStep1').classList.remove('hidden');
    document.getElementById('recoveryStep2').classList.add('hidden');
    document.getElementById('recUsername').value = '';
    document.getElementById('recEmail').value = '';
    document.getElementById('recCedula').value = '';
    document.getElementById('recTelefono').value = '';
    document.getElementById('recErrorMsg').innerText = '';
  }
}

function closeRecoveryModal() {
  const modal = document.getElementById('recoveryModal');
  if (modal) {
    modal.classList.add('hidden');
  }
}

async function verifyRecoveryData() {
  const username = document.getElementById('recUsername').value.trim();
  const email = document.getElementById('recEmail').value.trim();
  const cedula = document.getElementById('recCedula').value.trim();
  const telefono = document.getElementById('recTelefono').value.trim();
  const errorMsgEl = document.getElementById('recErrorMsg');

  if (errorMsgEl) errorMsgEl.innerText = "";

  if (!username || !email || !cedula || !telefono) {
    if (errorMsgEl) errorMsgEl.innerText = "Por favor completa todos los campos obligatorios.";
    return;
  }

  try {
    const res = await fetch(`${API_URL}/api/solicitar-recuperacion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, cedula, telefono })
    });

    const data = await res.json();

    if (res.ok && data.success) {
      document.getElementById('recoveryStep1').classList.add('hidden');
      document.getElementById('recoveryStep2').classList.remove('hidden');
    } else {
      if (errorMsgEl) {
        errorMsgEl.innerText = data.message || "No se pudo verificar la información.";
      } else {
        alert(data.message || "No se pudo verificar la información.");
      }
    }
  } catch (err) {
    console.error("Error en recuperación:", err);
    if (errorMsgEl) errorMsgEl.innerText = "Error de conexión con el servidor.";
  }
}

// ==========================================
// MODALES DE TÉRMINOS Y PRIVACIDAD
// ==========================================
function openTermsModal() {
  const modal = document.getElementById('termsModal');
  if (modal) modal.classList.remove('hidden');
}

function closeTermsModal() {
  const modal = document.getElementById('termsModal');
  if (modal) modal.classList.add('hidden');
}

function openPrivacyModal() {
  const modal = document.getElementById('privacyModal');
  if (modal) modal.classList.remove('hidden');
}

function closePrivacyModal() {
  const modal = document.getElementById('privacyModal');
  if (modal) modal.classList.add('hidden');
}

function togglePassword(inputId, iconId) {
  const input = document.getElementById(inputId);
  const icon = document.getElementById(iconId);
  
  if (!input || !icon) return;

  if (input.type === 'password') {
    input.type = 'text';
    icon.setAttribute('data-lucide', 'eye-off');
  } else {
    input.type = 'password';
    icon.setAttribute('data-lucide', 'eye');
  }
  
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
}
