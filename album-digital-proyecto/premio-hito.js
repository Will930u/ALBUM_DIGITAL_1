const API_URL = "https://album-digital-1.onrender.com";
const SUPABASE_URL = "https://dxicbitnnesjsqzxisea.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4aWNiaXRubmVzanNxenhpc2VhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0MTQzMTMsImV4cCI6MjEwNjk5MDMxM30.0xUXIa0Bby7xpJAF_N3y-n_H3SPwVlUBb9m630AFPtw";

const STATE = {
  bcvRate: 36.5,
  userId: localStorage.getItem('active_user_id') || null,
  userStickersCount: 0,
  userBalanceBs: 0,
  claimedMilestones: [],
  selectedMilestone: null,
  isProcessingWithdrawal: false,
  supabase: supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
};

document.addEventListener('DOMContentLoaded', async () => {
  if (!STATE.userId) {
    window.location.href = 'login.html';
    return;
  }
  try {
    lucide.createIcons();
    await fetchBcvRate();
    await loadUserDataFromDB();
  } catch (err) {
    console.error("Error al inicializar premios:", err);
  }
});

function logoutUser() {
  localStorage.removeItem('active_user_id');
  window.location.href = 'login.html';
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

  const { data: retirosData } = await STATE.supabase.from('retiros').select('milestone, estado').eq('usuario_id', STATE.userId);
  STATE.claimedMilestones = [];
  let hasActiveOrPending = false;

  if (retirosData) {
    retirosData.forEach(r => {
      if (r.estado === 'aprobado' || r.estado === 'pendiente') {
        if (r.milestone > 0) STATE.claimedMilestones.push(r.milestone);
      }
      if (r.estado === 'pendiente') hasActiveOrPending = true;
    });
  }

  STATE.isProcessingWithdrawal = hasActiveOrPending;
  renderMilestoneUI();
}

function renderMilestoneUI() {
  const balanceUSD = STATE.bcvRate > 0 ? (STATE.userBalanceBs / STATE.bcvRate).toFixed(2) : '0.00';
  document.getElementById('userBalanceDisplay').innerText = `Bs. ${STATE.userBalanceBs.toFixed(2)} ($${balanceUSD})`;
  
  const container = document.getElementById('milestoneOptions');
  container.innerHTML = '';

  [500, 1000, 1500, 2000].forEach(m => {
    const unlocked = STATE.userStickersCount >= m;
    const claimed = STATE.claimedMilestones.includes(m);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `p-3 rounded-xl border text-left transition ${claimed ? 'opacity-50 border-slate-700 bg-slate-900' : unlocked ? 'border-amber-500 bg-slate-900 text-white cursor-pointer hover:bg-amber-500/10' : 'opacity-40 border-slate-800 bg-slate-950 cursor-not-allowed'}`;
    btn.innerHTML = `<span class="font-bold text-amber-300 block">${m === 2000 ? 'Ciclo Completo #2000' : 'Hito #' + m}</span><span class="text-xs text-slate-300">$200.00 USD ${claimed ? '(Reclamado)' : ''}</span>`;

    if (unlocked && !claimed && !STATE.isProcessingWithdrawal) {
      btn.onclick = () => {
        STATE.selectedMilestone = m;
        document.getElementById('btnSendWithdraw').disabled = false;
        document.querySelectorAll('#milestoneOptions button').forEach(b => b.classList.remove('ring-2', 'ring-amber-400'));
        btn.classList.add('ring-2', 'ring-amber-400');
      };
    }
    container.appendChild(btn);
  });

  const btnLiq = document.getElementById('btnTotalLiquidate');
  if (STATE.isProcessingWithdrawal || STATE.userBalanceBs <= 0) {
    btnLiq.disabled = true;
  } else {
    btnLiq.disabled = false;
  }
}

async function submitWithdrawalRequest(e) {
  e.preventDefault();
  if (!STATE.selectedMilestone) return alert('Selecciona un hito primero.');
  const bank = document.getElementById('wBank').value.trim();
  const phone = document.getElementById('wPhone').value.trim();
  const id = document.getElementById('wId').value.trim();
  const bsVal = (200 * STATE.bcvRate).toFixed(2);
  const tipoRetiro = STATE.selectedMilestone === 2000 ? 'ciclo_completo' : 'hito_parcial';

  const res = await fetch(`${API_URL}/api/notificar-retiro`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario_id: STATE.userId, tipo: tipoRetiro, milestone: STATE.selectedMilestone, monto_bs: bsVal, monto_usd: 200.00, datos_pago: `${bank} | ${phone} | ${id}` })
  });

  if (res.ok) {
    alert('Solicitud de premio hito enviada con éxito.');
    window.location.href = 'album.html';
  } else {
    alert('Error al enviar solicitud de premio.');
  }
}

async function confirmTotalLiquidate() {
  if (STATE.userBalanceBs <= 0) return alert('Sin saldo neto para liquidar.');
  if (!confirm('¿Deseas liquidar tu saldo neto total? Esto enviará tu solicitud al administrador.')) return;
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
    alert('Liquidación total solicitada con éxito.');
    window.location.href = 'album.html';
  } else {
    alert('Error al solicitar liquidación.');
  }
}