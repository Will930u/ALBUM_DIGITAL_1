const API_URL = "https://album-digital-1.onrender.com";
const SUPABASE_URL = "https://dxicbitnnesjsqzxisea.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4aWNiaXRubmVzanNxenhpc2VhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0MTQzMTMsImV4cCI6MjEwNjk5MDMxM30.0xUXIa0Bby7xpJAF_N3y-n_H3SPwVlUBb9m630AFPtw";

const STATE = {
  currentPage: 1, totalPages: 80, stickersPerPage: 25, totalStickers: 2000,
  bcvRate: 36.5, userId: localStorage.getItem('active_user_id') || null,
  userStickersCount: 0, userBalanceBs: 0, claimedMilestones: [], selectedMilestone: null,
  isProcessingWithdrawal: false, logoClicks: 0, clickTimer: null,
  supabase: supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
};

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
    
    // Iniciar las notificaciones en tiempo real para este usuario (compras y retiros)
    initUserRealtimeNotifications(STATE.userId);
  } catch (err) {
    console.error("Error al inicializar el álbum:", err);
  }
});

function logoutUser() {
  localStorage.removeItem('active_user_id');
  window.location.href = 'index.html';
}

function renderAlbumPage() {
  const grid = document.getElementById('stickersGrid');
  grid.style.opacity = '0';
  
  setTimeout(() => {
    grid.innerHTML = '';
    const startIndex = (STATE.currentPage - 1) * STATE.stickersPerPage + 1;
    const endIndex = startIndex + STATE.stickersPerPage - 1;

    for (let i = startIndex; i <= endIndex; i++) {
      const isUnlocked = i <= STATE.userStickersCount;
      const isMilestone = (i % 500 === 0);
      const slot = document.createElement('div');
      slot.className = `metal-slot sticker-card aspect-[3/4] w-full max-w-[130px] rounded-xl flex flex-col items-center justify-center p-2 relative overflow-hidden cursor-pointer ${isUnlocked ? 'filled' : ''} ${isMilestone ? 'milestone-slot' : ''}`;
      
      if (isMilestone && isUnlocked) {
        slot.onclick = () => openWithdrawModal();
      } else if (isUnlocked) {
        slot.onclick = () => {
          triggerStickerAnimation(slot);
        };
      }

      if (isUnlocked) {
        const imgUrl = `${SUPABASE_URL}/storage/v1/object/public/barajitas/${i}.jpg`;
        slot.innerHTML = `<img src="${imgUrl}" class="w-full h-full object-cover rounded-lg" onerror="this.src='https://via.placeholder.com/150/1e1b4b/a855f7?text=${i}'"><span class="absolute bottom-1 right-1 bg-black/80 px-1.5 rounded text-[10px] font-bold text-purple-300">#${i}</span>`;
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
  if (!STATE.supabase) return;
  let { data: user } = await STATE.supabase.from('usuarios').select('*').eq('id', STATE.userId).single();
  if (user) {
    STATE.userStickersCount = user.cantidad_barajitas || 0;
    STATE.userBalanceBs = user.saldo_bs || 0;
  }

  const { data: retirosData } = await STATE.supabase.from('retiros').select('*').eq('usuario_id', STATE.userId);
  STATE.claimedMilestones = [];
  let hasActiveOrPending = false;

  if (retirosData) {
    // Ordenar de más antiguo a más reciente para rastrear la cronología del ciclo
    retirosData.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    // Encontrar el último momento en que ocurrió una liquidación total o ciclo completo (#2000)
    let ultimaLiquidacionIndex = -1;
    retirosData.forEach((r, idx) => {
      if ((r.tipo === 'liquidacion_total' || r.milestone >= 2000) && r.estado === 'aprobado') {
        ultimaLiquidacionIndex = idx;
      }
    });

    // Si hubo una liquidación, solo consideramos los retiros ocurridos DESPUÉS de esa liquidación para el ciclo actual
    const retirosCicloActual = ultimaLiquidacionIndex >= 0 ? retirosData.slice(ultimaLiquidacionIndex + 1) : retirosData;

    retirosCicloActual.forEach(r => {
      if (r.estado === 'aprobado' || r.estado === 'liquidado') {
        if (r.milestone > 0 && r.milestone < 2000) {
          STATE.claimedMilestones.push(r.milestone);
        }
      }
      if (r.estado === 'pendiente') {
        hasActiveOrPending = true;
      }
    });
  }

  STATE.isProcessingWithdrawal = hasActiveOrPending;
  updateUIHeader();
}

function updateUIHeader() {
  const balanceUSD = STATE.bcvRate > 0 ? (STATE.userBalanceBs / STATE.bcvRate).toFixed(2) : '0.00';
  document.getElementById('userBalanceBs').innerText = `Bs. ${STATE.userBalanceBs.toFixed(2)} ($${balanceUSD})`;
  const progressPct = ((STATE.userStickersCount / STATE.totalStickers) * 100).toFixed(1);
  document.getElementById('albumProgressText').innerText = `${STATE.userStickersCount} / ${STATE.totalStickers} (${progressPct}%)`;
  document.getElementById('albumProgressBar').style.width = `${progressPct}%`;

  const btnLiq = document.getElementById('btnHeaderTotalLiquidate');
  const btnMilestone = document.getElementById('btnHeaderMilestone');

  if (fnIsProcessingWithdrawal_Safe(STATE.isProcessingWithdrawal)) {
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

function fnIsProcessingWithdrawal_Safe(val) {
  return val;
}

function openWithdrawModal() {
  if (STATE.isProcessingWithdrawal) return alert('Tienes una solicitud de retiro activa.');
  
  if (STATE.userStickersCount >= 2000 && !STATE.claimedMilestones.includes(2000)) {
    const confirmarCiclo = confirm(
      "🌟 ¡FELICIDADES Y GRACIAS POR COMPLETAR EL ÁLBUM! 🌟\n\n" +
      "Has completado las 2000 barajitas (Ciclo Completo). Tu solicitud de pago será enviada para verificación y abono manual por parte del administrador.\n\n" +
      "Una vez aprobado y pagado exitosamente, recibirás tu notificación de éxito con las felicitaciones y el álbum se reiniciará para iniciar un nuevo ciclo completo.\n\n" +
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
        window.location.href = 'admin.html';
      } else {
        STATE.clickTimer = setTimeout(() => { STATE.logoClicks = 0; }, 3000);
      }
    });
  }
}

// ----------------------------------------------------
// MÓDULO DE NOTIFICACIONES EN TIEMPO REAL PARA EL USUARIO
// ----------------------------------------------------
function initUserRealtimeNotifications(usuarioId) {
  if (!STATE.supabase || !usuarioId) return;

  checkUserTransactionsStatus(usuarioId);
  checkUserWithdrawalNotifications(usuarioId);

  STATE.supabase
    .channel('public:transacciones')
    .on('postgres_changes', { 
      event: 'UPDATE', 
      schema: 'public', 
      table: 'transacciones',
      filter: `usuario_id=eq.${usuarioId}`
    }, payload => {
      const tx = payload.new;
      showTransactionStatusAlert(tx);
      loadUserDataFromDB();
      renderAlbumPage();
    })
    .subscribe();

  STATE.supabase
    .channel('public:retiros')
    .on('postgres_changes', { 
      event: 'UPDATE', 
      schema: 'public', 
      table: 'retiros',
      filter: `usuario_id=eq.${usuarioId}`
    }, payload => {
      const w = payload.new;
      showWithdrawalStatusAlert(w);
      loadUserDataFromDB();
      renderAlbumPage();
    })
    .subscribe();
}

async function checkUserTransactionsStatus(usuarioId) {
  const { data, error } = await STATE.supabase
    .from('transacciones')
    .select('*')
    .eq('usuario_id', usuarioId)
    .order('created_at', { ascending: false })
    .limit(3);

  if (!error && data) {
    data.forEach(tx => {
      if (tx.estado !== 'pendiente') {
        showTransactionStatusAlert(tx, false);
      }
    });
  }
}

async function checkUserWithdrawalNotifications(usuarioId) {
  const { data, error } = await STATE.supabase
    .from('retiros')
    .select('*')
    .eq('usuario_id', usuarioId)
    .eq('estado', 'aprobado')
    .order('created_at', { ascending: false })
    .limit(5);

  if (!error && data) {
    data.forEach(w => {
      const storageKey = `dismissed_retiro_${STATE.userId}_${w.id}`;
      if (localStorage.getItem(storageKey) !== 'true' && w.referencia) {
        showWithdrawalStatusAlert(w, false);
      }
    });
  }
}

function showTransactionStatusAlert(tx, animate = true) {
  const container = document.getElementById('userNotificationsContainer');
  if (!container) return;

  const storageKey = `dismissed_tx_${STATE.userId}_${tx.id}`;
  if (localStorage.getItem(storageKey) === 'true') return;

  const existingId = document.getElementById(`notif-tx-${tx.id}`);
  if (existingId) existingId.remove();

  const isApproved = tx.estado === 'aprobado';
  const bgClass = isApproved ? 'bg-emerald-900/90 border-emerald-500/50 text-emerald-200' : 'bg-red-900/90 border-red-500/50 text-red-200';
  const icon = isApproved ? 'check-circle' : 'alert-triangle';
  const title = isApproved ? '¡Pago Aprobado con Éxito!' : 'Pago Rechazado / Incompatible';
  const desc = isApproved 
    ? `Tu compra de ${tx.barajitas_qty || 0} barajitas (Ref: ${tx.referencia}) ha sido acreditada.` 
    : `Hubo un inconveniente con la referencia ${tx.referencia}. Por favor verifica tus datos o comunícate con soporte.`;

  const alertDiv = document.createElement('div');
  alertDiv.id = `notif-tx-${tx.id}`;
  alertDiv.className = `p-4 rounded-xl border ${bgClass} flex items-start justify-between gap-3 shadow-lg transition-all duration-300 ${animate ? 'animate-bounce-short' : ''}`;
  alertDiv.innerHTML = `
    <div class="flex items-start space-x-3">
      <i data-lucide="${icon}" class="w-5 h-5 mt-0.5 flex-shrink-0"></i>
      <div>
        <h4 class="font-bold text-sm">${title}</h4>
        <p class="text-xs opacity-90 mt-0.5">${desc}</p>
        <span class="text-[10px] opacity-70 mt-1 block">${new Date(tx.created_at || Date.now()).toLocaleString()}</span>
      </div>
    </div>
    <button onclick="dismissTransactionAlert(${tx.id})" class="text-xs opacity-70 hover:opacity-100 font-bold px-1.5 py-0.5">✕</button>
  `;

  container.prepend(alertDiv);
  lucide.createIcons();
}

function dismissTransactionAlert(txId) {
  localStorage.setItem(`dismissed_tx_${STATE.userId}_${txId}`, 'true');
  const alertElement = document.getElementById(`notif-tx-${txId}`);
  if (alertElement) alertElement.remove();
}

function showWithdrawalStatusAlert(w, animate = true) {
  const container = document.getElementById('userNotificationsContainer');
  if (!container) return;

  const storageKey = `dismissed_retiro_${STATE.userId}_${w.id}`;
  if (localStorage.getItem(storageKey) === 'true') return;

  const existingId = document.getElementById(`notif-retiro-${w.id}`);
  if (existingId) existingId.remove();

  const isApproved = w.estado === 'aprobado';
  const bgClass = isApproved ? 'bg-emerald-900/90 border-emerald-500/50 text-emerald-200' : 'bg-red-900/90 border-red-500/50 text-red-200';
  const icon = isApproved ? 'check-circle' : 'alert-triangle';
  const title = isApproved ? '¡Liquidación / Retiro Aprobado!' : 'Solicitud de Retiro Rechazada';
  const desc = isApproved 
    ? `🎉 ¡Tu pago ha sido procesado con éxito! Referencia de Pago Móvil: <b>${w.referencia || 'N/A'}</b>. ¡Disfruta tu dinero y prepárate para un nuevo ciclo!` 
    : `Tu solicitud de retiro o liquidación has sido rechazada. Comunícate con soporte para más detalles.`;

  const alertDiv = document.createElement('div');
  alertDiv.id = `notif-retiro-${w.id}`;
  alertDiv.className = `p-4 rounded-xl border ${bgClass} flex items-start justify-between gap-3 shadow-lg transition-all duration-300 ${animate ? 'animate-bounce-short' : ''}`;
  alertDiv.innerHTML = `
    <div class="flex items-start space-x-3">
      <i data-lucide="${icon}" class="w-5 h-5 mt-0.5 flex-shrink-0"></i>
      <div>
        <h4 class="font-bold text-sm">${title}</h4>
        <p class="text-xs opacity-90 mt-0.5">${desc}</p>
        <span class="text-[10px] opacity-70 mt-1 block">${new Date(w.created_at || Date.now()).toLocaleString()}</span>
      </div>
    </div>
    <button onclick="dismissRetiroAlert(${w.id})" class="text-xs opacity-70 hover:opacity-100 font-bold px-1.5 py-0.5">✕</button>
  `;

  container.prepend(alertDiv);
  lucide.createIcons();
}

function dismissRetiroAlert(wId) {
  localStorage.setItem(`dismissed_retiro_${STATE.userId}_${wId}`, 'true');
  const el = document.getElementById(`notif-retiro-${wId}`);
  if (el) el.remove();
}

function triggerStickerAnimation(cardElement) {
  cardElement.classList.add('rotate-360');
  setTimeout(() => {
    cardElement.classList.remove('rotate-360');
  }, 600);
}
