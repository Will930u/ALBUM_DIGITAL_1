const API_URL = "https://album-digital-1.onrender.com";
const STATE = {
  currentPage: 1, 
  totalPages: 40, // Ajustado a 40 páginas para 1000 barajitas
  stickersPerPage: 25, 
  totalStickers: 1000, // Ajustado a 1000 barajitas
  bcvRate: 36.5, 
  userId: localStorage.getItem('active_user_id') || null,
  userStickersCount: 0, 
  userBalanceBs: 0, 
  // Datos de pago precargados desde la tabla de usuarios de Supabase
  userBanco: '', 
  userCedula: '', 
  userTelefono: '',
  claimedMilestones: [], 
  selectedMilestone: null,
  isProcessingWithdrawal: false, 
  logoClicks: 0, 
  clickTimer: null,
  notifiedTransactions: new Set(),
  notifiedWithdrawals: new Set(),
  isInitialLoad: true
};

// Variables globales para el visor de pantalla completa (Lightbox)
let currentModalIndex = 0;
let allPageStickers = [];

document.addEventListener('DOMContentLoaded', async () => {
  if (!STATE.userId) {
    window.location.href = 'index.html';
    return;
  }
  try {
    lucide.createIcons();
    setupLogoClickCounter();
    await fetchBcvRate();
    await loadUserDataFromDB();
    renderAlbumPage();
    setupSwipeGestures();
    
    // Iniciar el carrusel de actividad en tiempo real
    initActivityTicker();
    
    // Iniciar verificación periódica en tiempo real (cada 5 segundos)
    initUserPollingNotifications(STATE.userId);
  } catch (err) {
    console.error("Error al inicializar el álbum:", err);
  }
});

async function logoutUser() {
  const activeUserId = localStorage.getItem('active_user_id');
  
  if (activeUserId) {
    try {
      await fetch(`${API_URL}/api/notificar-logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario_id: activeUserId })
      });
    } catch (err) {
      console.error('Error al notificar cierre de sesión:', err);
    }
  }

  localStorage.removeItem('active_user_id');
  window.location.href = 'index.html';
}

// ----------------------------------------------------
// CARRUSEL / TICKER DE ACTIVIDAD EN TIEMPO REAL
// ----------------------------------------------------
let feedActividadesGlobal = [];
let feedIndexActual = 0;
let feedIntervalId = null;

async function initActivityTicker() {
  await cargarFeedActividad();
  // Actualizar los datos desde el servidor cada 30 segundos
  setInterval(cargarFeedActividad, 30000);
}

async function cargarFeedActividad() {
  const tickerContainer = document.getElementById('tickerContent');
  if (!tickerContainer) return;

  try {
    const res = await fetch(`${API_URL}/api/feed-actividad`);
    const data = await res.json();

    if (data.status === 'success' && data.actividades && data.actividades.length > 0) {
      feedActividadesGlobal = data.actividades;
      feedIndexActual = 0;
      
      // Iniciar la rotación visual si no está activa
      if (!feedIntervalId) {
        mostrarSiguienteItemFeed();
        feedIntervalId = setInterval(mostrarSiguienteItemFeed, 5000); // Cambia de mensaje cada 5 segundos
      }
    } else {
      tickerContainer.innerHTML = `<span class="text-slate-400">✨ ¡Sé el primero en unirte a la acción comunitaria del álbum!</span>`;
    }
  } catch (err) {
    console.error("Error al cargar feed de actividad:", err);
  }
}

function mostrarSiguienteItemFeed() {
  const tickerContainer = document.getElementById('tickerContent');
  if (!tickerContainer || feedActividadesGlobal.length === 0) return;

  const item = feedActividadesGlobal[feedIndexActual];
  const usuario = item.usuario_id || 'Comunidad';
  const detalle = item.detalle || 'actividad en el álbum';
  const monto = item.monto_bs || 0;
  const esRetiro = item.tipo === 'retiro';

  // Icono y color dinámico según el tipo de evento
  const icono = esRetiro ? '🏆' : '🛒';
  const colorClase = esRetiro ? 'text-amber-300 font-bold' : 'text-amber-400 font-bold';

  tickerContainer.innerHTML = `
    <div class="animate-fade-ticker flex items-center justify-center space-x-1.5 text-center w-full">
      <span class="${colorClase}">${icono} <b>${usuario}</b></span>
      <span class="text-purple-200">${detalle}</span>
      <span class="text-emerald-400 text-[10px]">(Bs. ${parseFloat(monto).toFixed(2)})</span>
    </div>
  `;

  feedIndexActual = (feedIndexActual + 1) % feedActividadesGlobal.length;
}

// ----------------------------------------------------
// SISTEMA DE NOTIFICACIONES FLOTANTES EN TIEMPO REAL
// ----------------------------------------------------
function showFloatingNotification(message, type = 'success') {
  let container = document.getElementById('floatingNotificationsContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'floatingNotificationsContainer';
    container.className = 'fixed top-5 right-5 z-50 flex flex-col gap-3 max-w-md w-full px-4 pointer-events-none';
    document.body.appendChild(container);
  }

  const notif = document.createElement('div');
  notif.className = `pointer-events-auto p-4 rounded-2xl shadow-2xl border backdrop-blur-md transition-all transform translate-y-[-20px] opacity-0 flex items-start gap-3 ${
    type === 'success' 
      ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-200' 
      : 'bg-purple-950/90 border-purple-500/50 text-purple-200'
  }`;

  notif.innerHTML = `
    <div class="p-2 rounded-xl bg-emerald-500/20 text-emerald-400 mt-0.5">
      <i data-lucide="${type === 'success' ? 'check-circle-2' : 'bell'}" class="w-5 h-5"></i>
    </div>
    <div class="flex-1">
      <h4 class="font-bold text-sm text-white">¡Actualización en tu Álbum!</h4>
      <p class="text-xs mt-0.5 leading-relaxed">${message}</p>
    </div>
    <button onclick="this.parentElement.remove()" class="text-slate-400 hover:text-white text-sm font-bold">&times;</button>
  `;

  container.appendChild(notif);
  lucide.createIcons();

  setTimeout(() => {
    notif.classList.remove('translate-y-[-20px]', 'opacity-0');
  }, 50);

  setTimeout(() => {
    notif.classList.add('translate-y-[-20px]', 'opacity-0');
    setTimeout(() => notif.remove(), 300);
  }, 8000);
}

function renderAlbumPage() {
  const grid = document.getElementById('stickersGrid');
  if (!grid) return;
  grid.style.opacity = '0';
  
  setTimeout(() => {
    grid.innerHTML = '';
    const startIndex = (STATE.currentPage - 1) * STATE.stickersPerPage + 1;
    const endIndex = startIndex + STATE.stickersPerPage - 1;

    allPageStickers = [];

    for (let i = startIndex; i <= endIndex; i++) {
      const isUnlocked = i <= STATE.userStickersCount;
      const isMilestone = (i % 250 === 0); // Ajustado a hitos cada 250 barajitas (250, 500, 750, 1000)
      const slot = document.createElement('div');
      slot.className = `metal-slot sticker-card aspect-[2.5/3.5] w-full rounded-xl flex flex-col items-center justify-center p-2 relative overflow-hidden cursor-pointer ${isUnlocked ? 'filled' : ''} ${isMilestone ? 'milestone-slot' : ''}`;
      
      if (isUnlocked) {
        const imgUrl = `https://dxicbitnnesjsqzxisea.supabase.co/storage/v1/object/public/barajitas/${i}.jpg?t=${Date.now()}`;
        
        const stickerObj = {
          image: imgUrl,
          title: `Barajita #${i}`
        };
        allPageStickers.push(stickerObj);
        const currentIndexInPage = allPageStickers.length - 1;

        slot.innerHTML = `<img src="${imgUrl}" class="sticker-img pointer-events-none" onerror="this.src='https://via.placeholder.com/150/1e1b4b/a855f7?text=${i}'"><span class="absolute bottom-1 right-1 bg-black/80 px-1.5 rounded text-[10px] font-bold text-purple-300">#${i}</span>`;
        
        if (isMilestone) {
          slot.onclick = () => openWithdrawModal();
        } else {
          slot.onclick = () => {
            triggerStickerAnimation(slot);
            openStickerModal(stickerObj.image, stickerObj.title, currentIndexInPage);
          };
        }
      } else {
        slot.innerHTML = `<i data-lucide="${isMilestone ? 'award' : 'lock'}" class="w-6 h-6 text-purple-500/40 mb-1"></i><span class="text-xs font-bold text-slate-500">#${i}</span>`;
      }
      grid.appendChild(slot);
    }
    lucide.createIcons();
    grid.style.opacity = '1';
  }, 150);
}

function changePage(delta) {
  const p = STATE.currentPage + delta;
  if (p >= 1 && p <= STATE.totalPages) {
    STATE.currentPage = p;
    document.getElementById('currentPageNum').innerText = p;
    renderAlbumPage();
  }
}

async function fetchBcvRate() {
  try {
    const res = await fetch(`${API_URL}/api/bcv`);
    const data = await res.json();
    if (data.promedio) {
      STATE.bcvRate = data.promedio;
      return;
    }
  } catch (e) {}

  try {
    const res = await fetch('https://ve.dolarapi.com/v1/dolares/oficial');
    const data = await res.json();
    if (data.promedio) {
      STATE.bcvRate = data.promedio;
    }
  } catch (e) {}
}

async function loadUserDataFromDB() {
  try {
    const res = await fetch(`${API_URL}/api/usuario/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario_id: STATE.userId })
    });

    // 🔒 CAPA DE SEGURIDAD: Validar si la cuenta fue bloqueada (Estado 403)
    if (res.status === 403) {
      alert("🚨 Tu cuenta ha sido bloqueada o suspendida por el administrador.");
      logoutUser();
      return;
    }

    const data = await res.json();
    
    const previousStickersCount = STATE.userStickersCount;

    if (data && data.user) {
      // 🔒 CAPA DE SEGURIDAD: Validar si el campo booleano 'bloqueado' está activo en la BD
      if (data.user.bloqueado === true) {
        alert("🚨 Acceso revocado. Has sido expulsado del sistema.");
        logoutUser();
        return;
      }

      STATE.userStickersCount = data.user.cantidad_barajitas || 0;
      STATE.userBalanceBs = data.user.saldo_bs || 0;
      // Capturar los datos de pago precargados de Supabase
      STATE.userBanco = data.user.banco || '';
      STATE.userCedula = data.user.cedula || '';
      STATE.userTelefono = data.user.telefono || '';
    }

    if (previousStickersCount !== STATE.userStickersCount && !STATE.isInitialLoad) {
      renderAlbumPage();
    }

    if (data && data.transacciones) {
      data.transacciones.forEach(tx => {
        if (tx.estado === 'aprobado') {
          if (!STATE.notifiedTransactions.has(tx.id)) {
            STATE.notifiedTransactions.add(tx.id);
            if (!STATE.isInitialLoad) {
              showFloatingNotification(`¡Pago verificado con éxito! Se han acreditado ${tx.barajitas_qty} barajitas en tu álbum.`);
              renderAlbumPage();
            }
          }
        }
      });
    }

    STATE.claimedMilestones = [];
    let hasActiveOrPending = false;

    if (data && data.retiros) {
      data.retiros.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

      data.retiros.forEach(r => {
        if ((r.estado === 'aprobado' || r.estado === 'liquidado') && r.referencia) {
          const trackingKey = `approved_ref_${r.id}_${r.referencia}`;
          if (!STATE.notifiedWithdrawals.has(trackingKey)) {
            STATE.notifiedWithdrawals.add(trackingKey);
            if (!STATE.isInitialLoad) {
              const refText = ` Referencia bancaria: <b>${r.referencia}</b>`;
              if (r.tipo === 'liquidacion_total' || r.tipo === 'ciclo_completo' || r.milestone >= 1000) {
                showFloatingNotification(`¡Liquidación total aprobada y pagada!${refText}`);
                renderAlbumPage();
              } else {
                showFloatingNotification(`¡Tu solicitud de premio Hito #${r.milestone} fue aprobada!${refText}`);
              }
            }
          }
        }
        if (r.estado === 'pendiente') {
          hasActiveOrPending = true;
        }
      });

      let ultimaLiquidacionIndex = -1;
      data.retiros.forEach((r, idx) => {
        if ((r.tipo === 'liquidacion_total' || r.milestone >= 1000 || r.tipo === 'ciclo_completo') && r.estado === 'aprobado') {
          ultimaLiquidacionIndex = idx;
        }
      });

      const retirosCicloActual = ultimaLiquidacionIndex >= 0 ? data.retiros.slice(ultimaLiquidacionIndex + 1) : data.retiros;

      retirosCicloActual.forEach(r => {
        if ((r.estado === 'aprobado' || r.estado === 'liquidado') && r.milestone > 0 && r.milestone < 1000) {
          if (!STATE.claimedMilestones.includes(r.milestone)) {
            STATE.claimedMilestones.push(r.milestone);
          }
        }
      });
    }
      
    STATE.isProcessingWithdrawal = hasActiveOrPending;
    updateUIHeader();
    STATE.isInitialLoad = false;
  } catch (err) {
    console.error("Error al cargar datos del usuario desde el backend:", err);
  }
}

function updateUIHeader() {
  const balanceUSD = STATE.bcvRate > 0 ? (STATE.userBalanceBs / STATE.bcvRate).toFixed(2) : '0.00';
  document.getElementById('userBalanceBs').innerText = `Bs. ${STATE.userBalanceBs.toFixed(2)} ($${balanceUSD})`;
  const progressPct = ((STATE.userStickersCount / STATE.totalStickers) * 100).toFixed(1);
  document.getElementById('albumProgressText').innerText = `${STATE.userStickersCount} / ${STATE.totalStickers} (${progressPct}%)`;
  document.getElementById('albumProgressBar').style.width = `${progressPct}%`;

  const btnLiq = document.getElementById('btnHeaderTotalLiquidate');
  const btnMilestone = document.getElementById('btnHeaderMilestone');

  if (STATE.isProcessingWithdrawal) {
    if(btnLiq) btnLiq.disabled = true;
    if(btnMilestone) btnMilestone.disabled = true;
    return;
  }

  const milestoneBsValue = 100 * STATE.bcvRate; // Ajustado a $100 USD por hito
  const hasAvailableMilestone = [250, 500, 750, 1000].some(m =>
    STATE.userStickersCount >= m && !STATE.claimedMilestones.includes(m) && STATE.userBalanceBs >= milestoneBsValue
  );
  if(btnMilestone) btnMilestone.disabled = !hasAvailableMilestone;
  if(btnLiq) btnLiq.disabled = STATE.userBalanceBs <= 0;
}

// ----------------------------------------------------
// GESTIÓN DE PREMIOS CON DATOS PRECARGADOS DE SUPABASE ($100 USD)
// ----------------------------------------------------
function openWithdrawModal() {
  if (STATE.isProcessingWithdrawal) return alert('Tienes una solicitud de retiro activa.');
  
  if (!STATE.userBanco || !STATE.userTelefono || !STATE.userCedula) {
    alert("⚠️ No tienes configurados tus datos de pago (Banco, Cédula y Teléfono) en tu perfil.");
    return;
  }

  if (STATE.userStickersCount >= 1000 && !STATE.claimedMilestones.includes(1000)) {
    const confirmarCiclo = confirm(
      "🌟 ¡FELICIDADES Y GRACIAS POR COMPLETAR EL ÁLBUM! 🌟\n\n" +
      "Has completado las 1000 barajitas (Ciclo Completo). Tu solicitud de pago se enviará automáticamente con tus datos registrados:\n" +
      `🏦 Banco: ${STATE.userBanco}\n📱 Teléfono: ${STATE.userTelefono}\n🆔 Cédula: ${STATE.userCedula}\n\n¿Deseas proceder?`
    );
    if (confirmarCiclo) {
      ejecutarSolicitudPremio(1000, 'ciclo_completo');
    }
    return;
  }

  const container = document.getElementById('milestoneOptions');
  if(!container) return;
  container.innerHTML = '';

  [250, 500, 750, 1000].forEach(m => {
    const unlocked = STATE.userStickersCount >= m;
    const claimed = STATE.claimedMilestones.includes(m);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `p-3 rounded-xl border text-left transition ${claimed ? 'opacity-50 border-slate-700 bg-slate-900' : unlocked ? 'border-amber-500 bg-slate-900 text-white cursor-pointer hover:bg-amber-500/10' : 'opacity-40 border-slate-800 bg-slate-950 cursor-not-allowed'}`;
    btn.innerHTML = `<span class="font-bold text-amber-300 block">${m === 1000 ? 'Ciclo Completo #1000' : 'Hito #' + m}</span><span class="text-xs text-slate-300">$100.00 USD ${claimed ? '(Reclamado)' : ''}</span>`;

    if (unlocked && !claimed) {
      btn.onclick = () => {
        STATE.selectedMilestone = m;
        document.getElementById('btnSendWithdraw').disabled = false;
        document.querySelectorAll('#milestoneOptions button').forEach(b => b.classList.remove('ring-2', 'ring-amber-400'));
        btn.classList.add('ring-2', 'ring-amber-400');
      };
    }
    container.appendChild(btn);
  });

  // Mostrar datos precargados en el modal
  const infoDatos = document.getElementById('infoDatosPrecargados');
  if (infoDatos) {
    infoDatos.innerHTML = `💳 <b>Datos de Pago:</b> Banco: ${STATE.userBanco} | Tel: ${STATE.userTelefono} | Cédula: ${STATE.userCedula}`;
  }

  document.getElementById('withdrawModal').classList.remove('hidden');
}

function closeWithdrawModal() { 
  document.getElementById('withdrawModal').classList.add('hidden'); 
}

async function submitWithdrawalRequest() {
  if (!STATE.selectedMilestone) return alert('Selecciona un hito primero.');
  ejecutarSolicitudPremio(STATE.selectedMilestone, STATE.selectedMilestone === 1000 ? 'ciclo_completo' : 'hito_parcial');
}

async function ejecutarSolicitudPremio(milestoneVal, tipoRetiro) {
  if (!STATE.userBanco || !STATE.userTelefono || !STATE.userCedula) {
    return alert('Error: Faltan los datos de pago del usuario en el sistema.');
  }

  const bsVal = (100 * STATE.bcvRate).toFixed(2); // Ajustado a $100 USD

  const res = await fetch(`${API_URL}/api/notificar-retiro`, {
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      usuario_id: STATE.userId, 
      tipo: tipoRetiro, 
      milestone: milestoneVal, 
      monto_bs: bsVal, 
      monto_usd: 100.00, 
      datos_pago: `${STATE.userBanco} | ${STATE.userTelefono} | ${STATE.userCedula}` 
    })
  });

  if (res.ok) {
    alert('¡Solicitud enviada con éxito con tus datos guardados! Queda pendiente de verificación.');
    closeWithdrawModal();
    loadUserDataFromDB();
  } else {
    alert('Error al enviar la solicitud.');
  }
}

async function confirmTotalLiquidate() {
  if (STATE.userBalanceBs <= 0) return alert('Sin saldo neto para liquidar.');
  
  if (!STATE.userBanco || !STATE.userTelefono || !STATE.userCedula) {
    return alert('⚠️ No tienes tus datos de pago registrados en la base de datos.');
  }

  const aceptarLiquidacion = confirm(
    "⚠️ ADVERTENCIA DE LIQUIDACIÓN TOTAL ⚠️\n\n" +
    `Se procesará tu pago a los siguientes datos guardados:\n🏦 Banco: ${STATE.userBanco}\n📱 Teléfono: ${STATE.userTelefono}\n🆔 Cédula: ${STATE.userCedula}\n\n` +
    "Al aceptar, el saldo será enviado y **el álbum se reiniciará por completo**.\n\n¿Estás seguro de que deseas aceptar y liquidar tu saldo?"
  );
  
  if (!aceptarLiquidacion) return;

  const bsVal = STATE.userBalanceBs;
  const usdVal = STATE.bcvRate > 0 ? (bsVal / STATE.bcvRate).toFixed(2) : 0;

  const res = await fetch(`${API_URL}/api/notificar-retiro`, {
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      usuario_id: STATE.userId, 
      tipo: 'liquidacion_total', 
      milestone: 0, 
      monto_bs: bsVal.toFixed(2), 
      monto_usd: usdVal, 
      datos_pago: `${STATE.userBanco} | ${STATE.userTelefono} | ${STATE.userCedula}` 
    })
  });

  if (res.ok) {
    alert('¡Liquidación total solicitada con éxito con tus datos guardados! Al aprobarse, tu progreso se reiniciará.');
    loadUserDataFromDB();
  } else {
    alert('Error al solicitar liquidación.');
  }
}

function setupLogoClickCounter() {
  const logo = document.getElementById('appLogo');
  if (logo) {
    logo.addEventListener('click', () => {
      STATE.logoClicks++;
      clearTimeout(STATE.clickTimer);
      if (STATE.logoClicks >= 10) {
        STATE.logoClicks = 0;
        verificarAccesoAdminOculto();
      } else {
        STATE.clickTimer = setTimeout(() => { STATE.logoClicks = 0; }, 3000);
      }
    });
  }
}

async function verificarAccesoAdminOculto() {
  try {
    const res = await fetch(`${API_URL}/api/verificar-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario_id: STATE.userId })
    });
    const data = await res.json();

    if (res.status === 200 && data.status === 'authorized') {
      window.location.href = 'admin.html';
    } 
    else if (data.status === 'warning') {
      showFloatingNotification(`⚠️ Advertencia de Seguridad (${data.intentos}/3): Intento de acceso no autorizado registrado.`);
    } 
    else if (res.status === 403 || data.status === 'blocked') {
      showFloatingNotification("🚨 ¡Cuenta bloqueada permanentemente por intentos de acceso no autorizado!", "error");
      setTimeout(() => {
        logoutUser();
      }, 3500);
    } 
    else {
      showFloatingNotification("⚠️ Acceso denegado.", "error");
    }
  } catch (err) {
    console.error("Error al verificar permisos:", err);
    showFloatingNotification("Error de conexión al verificar permisos.", "error");
  }
}

function initUserPollingNotifications(usuarioId) {
  if (!usuarioId) return;

  setInterval(async () => {
    if (!STATE.userId) return;
    try {
      await loadUserDataFromDB();
    } catch (e) {}
  }, 5000);
}

function triggerStickerAnimation(cardElement) {
  cardElement.classList.add('rotate-360');
  setTimeout(() => {
    cardElement.classList.remove('rotate-360');
  }, 600);
}

// ==========================================
// VISOR DE BARAJITAS A PANTALLA COMPLETA (LIGHTBOX)
// ==========================================
function openStickerModal(imgSrc, titleText, index) {
  const modal = document.getElementById('stickerModal');
  const modalImg = document.getElementById('modalStickerImg');
  const modalTitle = document.getElementById('modalStickerTitle');

  if (!modal) return;

  modalImg.src = imgSrc;
  modalTitle.textContent = titleText;
  currentModalIndex = index;

  modal.classList.remove('hidden');
  
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
}

function closeStickerModal() {
  const modal = document.getElementById('stickerModal');
  if (modal) {
    modal.classList.add('hidden');
  }
}

function navigateStickerModal(direction) {
  if (allPageStickers.length > 0) {
    currentModalIndex += direction;
    
    if (currentModalIndex < 0) currentModalIndex = allPageStickers.length - 1;
    if (currentModalIndex >= allPageStickers.length) currentModalIndex = 0;

    const targetSticker = allPageStickers[currentModalIndex];
    if (targetSticker) {
      openStickerModal(targetSticker.image, targetSticker.title, currentModalIndex);
    }
  }
}

// ==========================================
// DETECCIÓN DE GESTOS TÁCTILES (SWIPE EN MÓVIL)
// ==========================================
let touchStartX = 0;
let touchEndX = 0;

function setupSwipeGestures() {
  const grid = document.getElementById('stickersGrid');
  if (!grid) return;

  grid.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
  }, { passive: true });

  grid.addEventListener('touchend', (e) => {
    touchEndX = e.changedTouches[0].screenX;
    handleSwipeGesture();
  }, { passive: true });
}

function handleSwipeGesture() {
  const swipeThreshold = 50;

  if (touchStartX - touchEndX > swipeThreshold) {
    changePage(1);
  }
  
  if (touchEndX - touchStartX > swipeThreshold) {
    changePage(-1);
  }
}

// 💓 ENVÍO SILENCIOSO DE LATIDO CADA 30 SEGUNDOS
setInterval(async () => {
  const activeUserId = localStorage.getItem('active_user_id');
  if (activeUserId) {
    try {
      await fetch(`${API_URL}/api/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario_id: activeUserId })
      });
    } catch (e) {
      console.error("Error al enviar latido:", e);
    }
  }
}, 10000);

// 💓 PULSO DE CONEXIÓN EN TIEMPO REAL (HEARTBEAT)
function enviarLatidoActivo() {
  const activeUserId = localStorage.getItem('active_user_id');
  if (activeUserId) {
    fetch(`${API_URL}/api/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario_id: activeUserId })
    }).catch(err => console.error("Error enviando latido:", err));
  }
}

// Enviar el primer latido al cargar y luego cada 10 segundos
document.addEventListener('DOMContentLoaded', () => {
  enviarLatidoActivo();
  setInterval(enviarLatidoActivo, 10000);
});

// ==========================================
// CAPTURA DEL PARÁMETRO ?REF= AL CARGAR LA PÁGINA
// ==========================================
window.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const refCode = urlParams.get('ref');
    
    if (refCode) {
        sessionStorage.setItem('codigo_referido_invitacion', refCode);
        console.log("🔗 Invitado por código de referido:", refCode);
    }
});

// ==========================================
// FUNCIONES DEL MODAL DE REFERIDOS
// ==========================================
async function openReferralModal() {
  const modal = document.getElementById('referralModal');
  const bodyContainer = document.getElementById('referralModalBody');
  if (!modal || !bodyContainer) return;

  modal.classList.remove('hidden');
  bodyContainer.innerHTML = `<p class="text-center text-purple-300 animate-pulse">Verificando estado de tu cuenta...</p>`;

  try {
    const response = await fetch(`${API_URL}/api/referidos/obtener-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario_id: STATE.userId })
    });

    const data = await response.json();

    if (data.success && data.unlocked) {
      // Desbloqueado: Muestra el link y el progreso
      bodyContainer.innerHTML = `
        <div class="space-y-3">
          <p class="text-slate-300 text-xs">Comparte tu enlace único. Por cada 10 amigos que se registren y compren su primera barajita, ganarás <b>$5.00</b> de saldo.</p>
          
          <div class="space-y-1">
            <label class="text-[11px] font-bold text-purple-300">Tu Enlace Personal:</label>
            <div class="flex gap-2">
              <input type="text" id="inputLinkRef" value="${data.link}" readonly class="w-full bg-slate-950 border border-purple-500/40 rounded-xl px-3 py-2 text-xs text-slate-200 select-all outline-none">
              <button onclick="copiarEnlaceReferido()" class="px-3 py-2 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl text-xs transition shrink-0 flex items-center gap-1">
                <i data-lucide="copy" class="w-3.5 h-3.5"></i> Copiar
              </button>
            </div>
          </div>

          <div class="p-3 rounded-xl bg-purple-950/50 border border-purple-500/30 space-y-1.5">
            <div class="flex justify-between text-xs">
              <span class="text-slate-400">📊 Referidos activos este mes:</span>
              <span class="font-bold text-cyan-400">${data.referidos_mes} / 10</span>
            </div>
            <div class="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-purple-500/20">
              <div class="bg-cyan-500 h-full transition-all duration-500" style="width: ${(data.referidos_mes / 10) * 100}%"></div>
            </div>
            <p class="text-[10px] text-slate-400 pt-1">💰 Bonos cobrados este mes: <strong class="text-emerald-400">${data.bonos_cobrados_mes} / 1</strong> (Límite mensual)</p>
          </div>
        </div>
      `;
    } else {
      // Bloqueado: No cumple el mínimo (100 barajitas)
      bodyContainer.innerHTML = `
        <div class="text-center space-y-3 py-2">
          <div class="w-12 h-12 mx-auto rounded-full bg-purple-900/50 border border-purple-500/40 flex items-center justify-center text-purple-400">
            <i data-lucide="lock" class="w-6 h-6"></i>
          </div>
          <h4 class="font-bold text-base text-purple-300">Candado de Referidos</h4>
          <p class="text-xs text-slate-300 leading-relaxed">${data.message || 'Debes comprar al menos 100 barajitas para desbloquear tu enlace de referido.'}</p>
        </div>
      `;
    }

    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
  } catch (err) {
    console.error("Error al obtener link de referido:", err);
    bodyContainer.innerHTML = `<p class="text-center text-red-400 text-xs">Error de conexión al cargar el sistema de referidos.</p>`;
  }
}

function closeReferralModal() {
  const modal = document.getElementById('referralModal');
  if (modal) modal.classList.add('hidden');
}

function copiarEnlaceReferido() {
  const input = document.getElementById('inputLinkRef');
  if (input) {
    input.select();
    input.setSelectionRange(0, 99999); // Para móviles
    navigator.clipboard.writeText(input.value).then(() => {
      showFloatingNotification("¡Enlace de referido copiado al portapapeles!");
    }).catch(() => {
      document.execCommand('copy');
      showFloatingNotification("¡Enlace copiado!");
    });
  }
}
