const API_URL = "https://album-digital-1.onrender.com";

const STATE = {
  currentPage: 1, totalPages: 80, stickersPerPage: 25, totalStickers: 2000,
  bcvRate: 36.5, userId: localStorage.getItem('active_user_id') || null,
  userStickersCount: 0, userBalanceBs: 0, claimedMilestones: [], selectedMilestone: null,
  isProcessingWithdrawal: false, logoClicks: 0, clickTimer: null,
  // Rastreo para evitar notificaciones repetidas
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
      // 🔴 Envía la notificación de cierre de sesión a Telegram antes de salir
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

    // Reiniciar arreglo temporal para el visor de la página actual
    allPageStickers = [];

    for (let i = startIndex; i <= endIndex; i++) {
      const isUnlocked = i <= STATE.userStickersCount;
      const isMilestone = (i % 500 === 0);
      const slot = document.createElement('div');
      slot.className = `metal-slot sticker-card aspect-[3/4] w-full max-w-[130px] rounded-xl flex flex-col items-center justify-center p-2 relative overflow-hidden cursor-pointer ${isUnlocked ? 'filled' : ''} ${isMilestone ? 'milestone-slot' : ''}`;
      
      if (isUnlocked) {
        const imgUrl = `https://dxicbitnnesjsqzxisea.supabase.co/storage/v1/object/public/barajitas/${i}.jpg?t=${Date.now()}`;
        
        // Registrar en el arreglo para la navegación del visor Lightbox
        const stickerObj = {
          image: imgUrl,
          title: `Barajita #${i}`
        };
        allPageStickers.push(stickerObj);
        const currentIndexInPage = allPageStickers.length - 1;

        slot.innerHTML = `<img src="${imgUrl}" class="w-full h-full object-cover rounded-lg pointer-events-none" onerror="this.src='https://via.placeholder.com/150/1e1b4b/a855f7?text=${i}'"><span class="absolute bottom-1 right-1 bg-black/80 px-1.5 rounded text-[10px] font-bold text-purple-300">#${i}</span>`;
        
        // Configurar acción al hacer clic: Si es hito y no reclamado abre retiro, de lo contrario abre el visor de pantalla completa
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
    const data = await res.json();
    
    const previousStickersCount = STATE.userStickersCount;

    if (data && data.user) {
      STATE.userStickersCount = data.user.cantidad_barajitas || 0;
      STATE.userBalanceBs = data.user.saldo_bs || 0;
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
              if (r.tipo === 'liquidacion_total' || r.tipo === 'ciclo_completo' || r.milestone >= 2000) {
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
        if ((r.tipo === 'liquidacion_total' || r.milestone >= 2000 || r.tipo === 'ciclo_completo') && r.estado === 'aprobado') {
          ultimaLiquidacionIndex = idx;
        }
      });

      const retirosCicloActual = ultimaLiquidacionIndex >= 0 ? data.retiros.slice(ultimaLiquidacionIndex + 1) : data.retiros;

      retirosCicloActual.forEach(r => {
        if ((r.estado === 'aprobado' || r.estado === 'liquidado') && r.milestone > 0 && r.milestone < 2000) {
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

  const milestoneBsValue = 200 * STATE.bcvRate;
  const hasAvailableMilestone = [500, 1000, 1500, 2000].some(m =>
    STATE.userStickersCount >= m && !STATE.claimedMilestones.includes(m) && STATE.userBalanceBs >= milestoneBsValue
  );
  if(btnMilestone) btnMilestone.disabled = !hasAvailableMilestone;
  if(btnLiq) btnLiq.disabled = STATE.userBalanceBs <= 0;
}

function openWithdrawModal() {
  if (STATE.isProcessingWithdrawal) return alert('Tienes una solicitud de retiro activa.');
  
  if (STATE.userStickersCount >= 2000 && !STATE.claimedMilestones.includes(2000)) {
    const confirmarCiclo = confirm(
      "🌟 ¡FELICIDADES Y GRACIAS POR COMPLETAR EL ÁLBUM! 🌟\n\n" +
      "Has completado las 2000 barajitas (Ciclo Completo). Tu solicitud de pago será enviada para verificación y abono manual por parte del administrador.\n\n" +
      "Una vez aprobado y pagado exitosamente, recibirás tu notificación de éxito y el álbum se reiniciará para iniciar un nuevo ciclo completo.\n\n" +
      "¿Deseas proceder con la solicitud?"
    );
    if (confirmarCiclo) {
      STATE.selectedMilestone = 2000;
      ejecutarSolicitudPremio(2000, 'ciclo_completo');
    }
    return;
  }

  const container = document.getElementById('milestoneOptions');
  if(!container) return;
  container.innerHTML = '';

  [500, 1000, 1500, 2000].forEach(m => {
    const unlocked = STATE.userStickersCount >= m;
    const claimed = STATE.claimedMilestones.includes(m);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `p-3 rounded-xl border text-left transition ${claimed ? 'opacity-50 border-slate-700 bg-slate-900' : unlocked ? 'border-amber-500 bg-slate-900 text-white cursor-pointer hover:bg-amber-500/10' : 'opacity-40 border-slate-800 bg-slate-950 cursor-not-allowed'}`;
    btn.innerHTML = `<span class="font-bold text-amber-300 block">${m === 2000 ? 'Ciclo Completo #2000' : 'Hito #' + m}</span><span class="text-xs text-slate-300">$200.00 USD ${claimed ? '(Reclamado)' : ''}</span>`;

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
  document.getElementById('withdrawModal').classList.remove('hidden');
}

function closeWithdrawModal() { document.getElementById('withdrawModal').classList.add('hidden'); }

async function submitWithdrawalRequest(e) {
  e.preventDefault();
  if (!STATE.selectedMilestone) return alert('Selecciona un hito primero.');
  ejecutarSolicitudPremio(STATE.selectedMilestone, STATE.selectedMilestone === 2000 ? 'ciclo_completo' : 'hito_parcial');
}

async function ejecutarSolicitudPremio(milestoneVal, tipoRetiro) {
  const bank = document.getElementById('wBank')?.value.trim() || prompt("Ingresa tu Banco:");
  const phone = document.getElementById('wPhone')?.value.trim() || prompt("Ingresa tu Teléfono de Pago Móvil:");
  const id = document.getElementById('wId')?.value.trim() || prompt("Ingresa tu Cédula:");
  if (!bank || !phone || !id) return;

  const bsVal = (200 * STATE.bcvRate).toFixed(2);

  const res = await fetch(`${API_URL}/api/notificar-retiro`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario_id: STATE.userId, tipo: tipoRetiro, milestone: milestoneVal, monto_bs: bsVal, monto_usd: 200.00, datos_pago: `${bank} | ${phone} | ${id}` })
  });

  if (res.ok) {
    alert('¡Solicitud enviada con éxito! Queda pendiente de verificación.');
    closeWithdrawModal();
    loadUserDataFromDB();
  } else {
    alert('Error al enviar la solicitud.');
  }
}

async function confirmTotalLiquidate() {
  if (STATE.userBalanceBs <= 0) return alert('Sin saldo neto para liquidar.');
  
  const aceptarLiquidacion = confirm(
    "⚠️ ADVERTENCIA DE LIQUIDACIÓN TOTAL ⚠️\n\n" +
    "Si aceptas liquidar tu dinero, este se te depositará, pero **el álbum se reiniciará por completo**.\n\n" +
    "Los hitos que no hayas reclamado individualmente no quedarán como reclamados, sino que se restablecerán como si nunca hubiesen llegado ahí (empezarás un nuevo ciclo).\n\n" +
    "¿Estás seguro de que deseas aceptar y liquidar tu saldo?"
  );
  
  if (!aceptarLiquidacion) return;

  const bank = prompt("Ingresa tu Banco:");
  const phone = prompt("Ingresa tu Teléfono de Pago Móvil:");
  const id = prompt("Ingresa tu Cédula:");
  if (!bank || !phone || !id) return;

  const bsVal = STATE.userBalanceBs;
  const usdVal = STATE.bcvRate > 0 ? (bsVal / STATE.bcvRate).toFixed(2) : 0;

  const res = await fetch(`${API_URL}/api/notificar-retiro`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario_id: STATE.userId, tipo: 'liquidacion_total', milestone: 0, monto_bs: bsVal.toFixed(2), monto_usd: usdVal, datos_pago: `${bank} | ${phone} | ${id}` })
  });

  if (res.ok) {
    alert('Liquidación total solicitada con éxito. Al aprobarse, tu progreso se reiniciará.');
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
