const API_URL = "https://album-digital-1.onrender.com";
const STATE = {
  bcvRate: 36.5,
  userId: localStorage.getItem('active_user_id') || null,
  userCurrentStickers: 0,
  maxAllowedToBuy: 1000
};

document.addEventListener('DOMContentLoaded', async () => {
  if (!STATE.userId) {
    window.location.href = 'index.html';
    return;
  }
  try {
    lucide.createIcons();
    await fetchBcvRate();
    await loadPlatformPaymentInfo(); 
    await loadUserAlbumProgress();
    
    const today = new Date().toISOString().split('T')[0];
    const dateField = document.getElementById('dateInput');
    if (dateField) dateField.value = today;

    // ==========================================
    // 🎵 CONTROL DE MÚSICA DE FONDO CONTINUA (TIENDA)
    // ==========================================
    const bgMusic = document.getElementById('bgMusic');
    const shouldPlay = localStorage.getItem('playMusic');
    const savedTime = localStorage.getItem('audioTime');

    if (bgMusic && shouldPlay === 'true') {
      if (savedTime) {
        bgMusic.currentTime = parseFloat(savedTime);
      }
      
      bgMusic.volume = 0.4;
      bgMusic.play().catch(err => {
        console.log("El navegador bloqueó el autoplay o requiere interacción:", err);
      });

      bgMusic.ontimeupdate = () => {
        localStorage.setItem('audioTime', bgMusic.currentTime);
      };
    }
    // ==========================================

  } catch (err) {
    console.error("Error al inicializar la tienda:", err);
  }
});

function logoutUser() {
  localStorage.removeItem('active_user_id');
  window.location.href = 'index.html';
}

async function fetchBcvRate() {
  try {
    const res = await fetch(`${API_URL}/api/bcv`);
    const data = await res.json();
    if (data.promedio) {
      STATE.bcvRate = data.promedio;
      document.getElementById('bcvRateDisplay').innerText = `Bs. ${STATE.bcvRate.toFixed(2)}`;
      calculateTotal();
      return;
    }
  } catch (e) {}

  try {
    const res = await fetch('https://ve.dolarapi.com/v1/dolares/oficial');
    const data = await res.json();
    if (data.promedio) {
      STATE.bcvRate = data.promedio;
      document.getElementById('bcvRateDisplay').innerText = `Bs. ${STATE.bcvRate.toFixed(2)}`;
      calculateTotal();
    }
  } catch (e) {
    document.getElementById('bcvRateDisplay').innerText = `Bs. ${STATE.bcvRate.toFixed(2)} (Ref)`;
    calculateTotal();
  }
}

// 🛡️ CARGAR PROGRESO DEL USUARIO Y LIMITAR COMPRA MÁXIMA A 1000 BARAJITAS
async function loadUserAlbumProgress() {
  try {
    const sessionToken = localStorage.getItem('session_token');
    const res = await fetch(`${API_URL}/api/usuario/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        usuario_id: STATE.userId,
        session_token: sessionToken 
      })
    });
    const data = await res.json();

    if (data && data.user) {
      STATE.userCurrentStickers = data.user.cantidad_barajitas || 0;
      STATE.maxAllowedToBuy = Math.max(0, 1000 - STATE.userCurrentStickers);

      const progressInfo = document.getElementById('userProgressInfo');
      if (progressInfo) {
        progressInfo.innerText = `${STATE.userCurrentStickers} / 1000 barajitas`;
      }

      const qtyInput = document.getElementById('stickerQty');
      const warningSpan = document.getElementById('maxPurchaseWarning');

      if (qtyInput) {
        qtyInput.max = STATE.maxAllowedToBuy;
        if (STATE.maxAllowedToBuy <= 0) {
          qtyInput.value = 0;
          qtyInput.disabled = true;
          warningSpan.innerHTML = "🌟 ¡Felicidades! Ya has completado las 1000 barajitas del álbum.";
        } else {
          qtyInput.value = Math.min(1, STATE.maxAllowedToBuy);
          warningSpan.innerHTML = `⚠️ Puedes comprar un máximo de <b>${STATE.maxAllowedToBuy}</b> barajitas para completar tu álbum.`;
        }
      }
      calculateTotal();
    }
  } catch (e) {
    console.error("Error al obtener progreso de barajitas del usuario:", e);
  }
}

function calculateTotal() {
  const qtyInput = document.getElementById('stickerQty');
  let qty = parseInt(qtyInput.value) || 0;

  if (qty > STATE.maxAllowedToBuy) {
    qty = STATE.maxAllowedToBuy;
    qtyInput.value = qty;
  }
  if (qty < 0) {
    qty = 0;
    qtyInput.value = 0;
  }

  const totalUSD = qty * 0.62;
  const totalBs = totalUSD * STATE.bcvRate;
  
  document.getElementById('totalUSDDisplay').innerText = `$${totalUSD.toFixed(2)}`;
  document.getElementById('totalBsDisplay').innerText = `Bs. ${totalBs.toFixed(2)}`;
}

async function loadPlatformPaymentInfo() {
  try {
    const res = await fetch(`${API_URL}/api/admin/configuracion`);
    const data = await res.json();
    if (data) {
      const elBanco = document.getElementById('infoBanco');
      const elTel = document.getElementById('infoTelefono');
      const elCed = document.getElementById('infoCedula');
      const elTit = document.getElementById('infoTitular');

      if (elBanco) elBanco.innerText = data.banco || 'N/A';
      if (elTel) elTel.innerText = data.telefono || 'N/A';
      if (elCed) elCed.innerText = data.cedula || 'N/A';
      if (elTit) elTit.innerText = data.titular || 'N/A';
    }
  } catch (e) {
    console.error("No se pudieron cargar los datos de pago de la plataforma", e);
  }
}

async function submitPurchase(e) {
  e.preventDefault();
  const qty = parseInt(document.getElementById('stickerQty').value) || 0;
  const phone = escapeHTML(document.getElementById('phoneInput').value.trim());
  const bank = escapeHTML(document.getElementById('bankInput').value.trim());
  const ref = escapeHTML(document.getElementById('refInput').value.trim());
  const fechaPago = document.getElementById('dateInput').value;
  const btnSubmit = document.getElementById('btnSubmitPurchase');

  if (qty <= 0) {
    showFloatingNotification('La cantidad de barajitas debe ser mayor a 0 o ya has completado el álbum.', 'error');
    return;
  }

  if (qty > STATE.maxAllowedToBuy) {
    showFloatingNotification(`No puedes comprar esa cantidad. Solo te faltan ${STATE.maxAllowedToBuy} barajitas para completar el álbum.`, 'error');
    return;
  }

  if (!phone || !bank || !ref || !fechaPago) {
    showFloatingNotification('Por favor completa todos los campos del formulario de pago.', 'error');
    return;
  }

  const totalUSD = qty * 0.62;
  const totalBs = totalUSD * STATE.bcvRate;
  btnSubmit.disabled = true;
  btnSubmit.innerText = "REPORTANDO...";

  try {
    const sessionToken = localStorage.getItem('session_token');
    const res = await fetch(`${API_URL}/api/notificar-compra`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usuario_id: STATE.userId,
        session_token: sessionToken,
        barajitas_qty: qty,
        monto_bs: totalBs,
        monto_usd: totalUSD,
        telefono: phone,
        banco: bank,
        referencia: ref,
        fecha_pago: fechaPago
      })
    });

    const data = await res.json();
    if (!res.ok) {
      showFloatingNotification('Error: ' + (data.message || 'No se pudo reportar el pago'), 'error');
      btnSubmit.disabled = false;
      btnSubmit.innerText = "REPORTAR PAGO Y SOLICITAR BARAJITAS";
      return;
    }

    showFloatingNotification('¡Pago reportado con éxito! En revisión por el administrador.', 'success');
    
    // Retraso de 1.5s para que el usuario alcance a ver la notificación antes de cambiar de página
    setTimeout(() => {
      window.location.href = 'album.html';
    }, 1500);

  } catch (err) {
    console.error(err);
    showFloatingNotification('Error de conexión con el servidor.', 'error');
    btnSubmit.disabled = false;
    btnSubmit.innerText = "REPORTAR PAGO Y SOLICITAR BARAJITAS";
  }
}

// 🔔 SISTEMA DE NOTIFICACIONES FLOTANTES (TOAST)
function showFloatingNotification(message, type = 'success') {
  let container = document.getElementById('floatingNotificationsContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'floatingNotificationsContainer';
    container.className = 'fixed top-5 right-5 z-50 flex flex-col gap-3 max-w-md w-full px-4 pointer-events-none';
    document.body.appendChild(container);
  }

  const isSuccess = type === 'success';
  const notif = document.createElement('div');
  notif.className = `pointer-events-auto p-4 rounded-2xl shadow-2xl border backdrop-blur-md transition-all transform translate-y-[-20px] opacity-0 flex items-start gap-3 ${
    isSuccess 
      ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-200' 
      : 'bg-red-950/90 border-red-500/50 text-red-200'
  }`;

  notif.innerHTML = `
    <div class="p-2 rounded-xl ${isSuccess ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'} mt-0.5">
      <i data-lucide="${isSuccess ? 'check-circle-2' : 'alert-triangle'}" class="w-5 h-5"></i>
    </div>
    <div class="flex-1">
      <h4 class="font-bold text-sm text-white">${isSuccess ? '¡Operación Exitosa!' : 'Atención'}</h4>
      <p class="text-xs mt-0.5 leading-relaxed">${message}</p>
    </div>
    <button onclick="this.parentElement.remove()" class="text-slate-400 hover:text-white text-sm font-bold">&times;</button>
  `;

  container.appendChild(notif);
  if (typeof lucide !== 'undefined') { lucide.createIcons(); }

  setTimeout(() => {
    notif.classList.remove('translate-y-[-20px]', 'opacity-0');
  }, 50);

  setTimeout(() => {
    notif.classList.add('translate-y-[-20px]', 'opacity-0');
    setTimeout(() => notif.remove(), 300);
  }, 5000);
}

// 🛡️ Función auxiliar anti-XSS
function escapeHTML(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
