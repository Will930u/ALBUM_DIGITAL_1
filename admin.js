const API_URL = "https://album-digital-1.onrender.com";
const SUPABASE_URL = "https://dxicbitnnesjsqzxisea.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4aWNiaXRubmVzanNxenhpc2VhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0MTQzMTMsImV4cCI6MjEwNjk5MDMxM30.0xUXIa0Bby7xpJAF_N3y-n_H3SPwVlUBb9m630AFPtw";

const STATE = {
  supabase: supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
};

// 🛡️ VALIDACIÓN DE SEGURIDAD EXCLUSIVA PARA EL ADMINISTRADOR EN ADMIN.JS
document.addEventListener('DOMContentLoaded', async () => {
  const activeUserId = localStorage.getItem('active_user_id');
  if (!activeUserId) {
    window.location.href = 'index.html';
    return;
  }

  try {
    const response = await fetch(`${API_URL}/api/verificar-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario_id: activeUserId })
    });
    
    const data = await response.json();
    
    // Si el servidor responde con error 403 (bloqueado o no autorizado)
    if (response.status === 403 || data.status === 'blocked' || data.status === 'unauthorized') {
      if (data.status === 'blocked' || response.status === 403) {
        alert("Advertencia de Seguridad: Tu cuenta ha sido bloqueada debido a intentos de acceso no autorizado a áreas restringidas.");
      } else {
        alert("Advertencia: Intento de acceso no autorizado registrado.");
      }
      
      // 🚫 DESTRUIR LA SESIÓN Y EXPULSAR AL LOGIN (INDEX.HTML)
      localStorage.removeItem('active_user_id');
      window.location.href = 'index.html';
      return;
    }

    if (data.status !== 'authorized') {
      localStorage.removeItem('active_user_id');
      window.location.href = 'index.html';
      return;
    }
  } catch (e) {
    localStorage.removeItem('active_user_id');
    window.location.href = 'index.html';
    return;
  }

  // Si es el admin real, inicializa el panel con normalidad
  initAdminDashboard();
});

// Actualizar la función switchAdminTab para incluir 'config'
function switchAdminTab(tab) {
  document.getElementById('adminContentPagos').classList.add('hidden');
  document.getElementById('adminContentRetiros').classList.add('hidden');
  document.getElementById('adminContentImagenes').classList.add('hidden');
  document.getElementById('adminContentMetricas').classList.add('hidden');
  document.getElementById('adminContentUsuarios').classList.add('hidden');
  const cfgDiv = document.getElementById('adminContentConfig');
  if (cfgDiv) cfgDiv.classList.add('hidden');

  document.getElementById('tabAdminPagos').className = "pb-3 font-semibold text-sm border-b-2 border-transparent text-slate-400 whitespace-nowrap";
  document.getElementById('tabAdminRetiros').className = "pb-3 font-semibold text-sm border-b-2 border-transparent text-slate-400 whitespace-nowrap";
  document.getElementById('tabAdminImagenes').className = "pb-3 font-semibold text-sm border-b-2 border-transparent text-slate-400 whitespace-nowrap";
  document.getElementById('tabAdminMetricas').className = "pb-3 font-semibold text-sm border-b-2 border-transparent text-slate-400 whitespace-nowrap";
  document.getElementById('tabAdminUsuarios').className = "pb-3 font-semibold text-sm border-b-2 border-transparent text-slate-400 whitespace-nowrap";
  const tabCfg = document.getElementById('tabAdminConfig');
  if (tabCfg) tabCfg.className = "pb-3 font-semibold text-sm border-b-2 border-transparent text-slate-400 whitespace-nowrap";

  if (tab === 'pagos') {
    document.getElementById('adminContentPagos').classList.remove('hidden');
    document.getElementById('tabAdminPagos').className = "pb-3 font-semibold text-sm border-b-2 border-purple-500 text-purple-300 whitespace-nowrap";
    loadPendingPayments();
  } else if (tab === 'retiros') {
    document.getElementById('adminContentRetiros').classList.remove('hidden');
    document.getElementById('tabAdminRetiros').className = "pb-3 font-semibold text-sm border-b-2 border-purple-500 text-purple-300 whitespace-nowrap";
    loadPendingWithdrawals();
  } else if (tab === 'imagenes') {
    document.getElementById('adminContentImagenes').classList.remove('hidden');
    document.getElementById('tabAdminImagenes').className = "pb-3 font-semibold text-sm border-b-2 border-purple-500 text-purple-300 whitespace-nowrap";
  } else if (tab === 'metricas') {
    document.getElementById('adminContentMetricas').classList.remove('hidden');
    document.getElementById('tabAdminMetricas').className = "pb-3 font-semibold text-sm border-b-2 border-purple-500 text-purple-300 whitespace-nowrap";
    renderFinancialMetrics();
  } else if (tab === 'usuarios') {
    document.getElementById('adminContentUsuarios').classList.remove('hidden');
    document.getElementById('tabAdminUsuarios').className = "pb-3 font-semibold text-sm border-b-2 border-purple-500 text-purple-300 whitespace-nowrap";
    loadUserList();
  } else if (tab === 'config') {
    if (cfgDiv) cfgDiv.classList.remove('hidden');
    if (tabCfg) tabCfg.className = "pb-3 font-semibold text-sm border-b-2 border-purple-500 text-purple-300 whitespace-nowrap";
    loadPlatformConfigAdmin();
  }
}

async function loadPlatformConfigAdmin() {
  const { data, error } = await STATE.supabase.from('configuracion').select('*').limit(1).maybeSingle();
  if (data) {
    document.getElementById('cfgBanco').value = data.banco || '';
    document.getElementById('cfgTelefono').value = data.telefono || '';
    document.getElementById('cfgCedula').value = data.cedula || '';
    document.getElementById('cfgTitular').value = data.titular || '';
  }
}

async function savePlatformConfig(e) {
  e.preventDefault();
  const banco = document.getElementById('cfgBanco').value.trim();
  const telefono = document.getElementById('cfgTelefono').value.trim();
  const cedula = document.getElementById('cfgCedula').value.trim();
  const titular = document.getElementById('cfgTitular').value.trim();

  const { error } = await STATE.supabase.from('configuracion').upsert({
    id: 1,
    banco,
    telefono,
    cedula,
    titular
  });

  if (!error) {
    alert('¡Datos de pago de la plataforma actualizados con éxito!');
  } else {
    alert('Error al guardar la configuración.');
  }
}

async function loadPendingPayments() {
  const tbody = document.getElementById('pendingPaymentsTable');
  tbody.innerHTML = '';
  const { data, error } = await STATE.supabase
    .from('transacciones')
    .select('*')
    .eq('estado', 'pendiente')
    .order('created_at', { ascending: false });

  if (error || !data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-500">Sin pagos pendientes en transacciones.</td></tr>`;
    return;
  }

  data.forEach(tx => {
    const montoVal = tx.monto_bs !== null && tx.monto_bs !== undefined ? tx.monto_bs : (tx.monto !== null && tx.monto !== undefined ? tx.monto : 0.00);
    tbody.innerHTML += `
      <tr class="border-b border-slate-800">
        <td class="p-3">${new Date(tx.created_at).toLocaleString()}</td>
        <td class="p-3 font-mono">${tx.usuario_id || 'N/A'}</td>
        <td class="p-3">${tx.barajitas_qty || 0}</td>
        <td class="p-3">Bs. ${parseFloat(montoVal).toFixed(2)}</td>
        <td class="p-3 font-mono">${tx.referencia || 'S/N'}</td>
        <td class="p-3 text-center space-x-1">
          <button onclick="processAdminPayment(${tx.id}, 'aprobar')" class="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold transition">Aprobar</button>
          <button onclick="processAdminPayment(${tx.id}, 'rechazar')" class="px-2.5 py-1 bg-red-600 hover:bg-red-500 text-white rounded text-xs font-bold transition">Rechazar</button>
        </td>
      </tr>`;
  });
}

async function processAdminPayment(txId, accion) {
  try {
    const res = await fetch(`${API_URL}/api/procesar-compra-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tx_id: txId, accion: accion })
    });
    if (res.ok) {
      loadPendingPayments();
    } else {
      console.error('Error al procesar la compra.');
    }
  } catch (err) {
    console.error('Error de conexión al procesar el pago:', err);
  }
}

async function loadPendingWithdrawals() {
  const tbody = document.getElementById('pendingWithdrawalsTable');
  tbody.innerHTML = '';
  const { data } = await STATE.supabase.from('retiros').select('*').eq('estado', 'pendiente');
  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-500">Sin retiros pendientes.</td></tr>`;
    return;
  }
  data.forEach(w => {
    tbody.innerHTML += `
      <tr class="border-b border-slate-800">
        <td class="p-3">${new Date(w.created_at).toLocaleString()}</td>
        <td class="p-3 font-mono">${w.usuario_id}</td>
        <td class="p-3">${w.tipo}</td>
        <td class="p-3">$${w.monto_usd}</td>
        <td class="p-3">${w.datos_pago}</td>
        <td class="p-3 text-center space-x-1">
          <button onclick="processAdminWithdrawal(${w.id}, 'aprobar')" class="px-2.5 py-1 bg-emerald-600 text-white rounded text-xs font-bold transition">Aprobar</button>
          <button onclick="processAdminWithdrawal(${w.id}, 'rechazar')" class="px-2.5 py-1 bg-red-600 text-white rounded text-xs font-bold transition">Rechazar</button>
        </td>
      </tr>`;
  });
}

async function processAdminWithdrawal(wId, accion) {
  let referencia = '';
  if (accion === 'aprobar') {
    referencia = prompt("Ingresa el número de referencia del Pago Móvil realizado al usuario:");
    if (!referencia) return;
  }

  try {
    const res = await fetch(`${API_URL}/api/procesar-retiro-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ w_id: wId, accion: accion, referencia: referencia })
    });
    if (res.ok) {
      loadPendingWithdrawals();
    } else {
      console.error('Error al procesar retiro.');
    }
  } catch (err) {
    console.error('Error de conexión al procesar retiro:', err);
  }
}

async function uploadStickerImagesBatch(e) {
  e.preventDefault();
  const fileInput = document.getElementById('imgFileAssetBatch');
  const container = document.getElementById('uploadProgressContainer');
  const bar = document.getElementById('uploadProgressBar');
  container.classList.remove('hidden');

  let exitosas = 0;
  const totalFiles = fileInput.files.length;
  for (let i = 0; i < totalFiles; i++) {
    const file = fileInput.files[i];
    const numMatch = file.name.match(/^(\d+)\./);
    if (numMatch) {
      const stickerNum = parseInt(numMatch[1]);
      const { error: storageError } = await STATE.supabase.storage.from('barajitas').upload(`${stickerNum}.jpg`, file, { upsert: true });
      if (!storageError) {
        exitosas++;
        const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/barajitas/${stickerNum}.jpg`;
        await STATE.supabase.from('barajitas').upsert([{ numero: stickerNum, imagen_url: publicUrl }], { onConflict: 'numero' });
      }
    }
    bar.style.width = `${Math.round(((i + 1) / totalFiles) * 100)}%`;
  }
  container.classList.add('hidden');
}

async function renderFinancialMetrics() {
  const { data } = await STATE.supabase.from('transacciones').select('*').eq('estado', 'aprobado');
  const totalSales = (data || []).reduce((sum, t) => sum + parseFloat(t.monto_bs || t.monto || 0), 0);
  document.getElementById('metricTotalSales').innerText = `Bs. ${totalSales.toFixed(2)}`;
  document.getElementById('metricPlatformProfit').innerText = `Bs. ${(totalSales * 0.30).toFixed(2)}`;
  document.getElementById('metricUserNetValue').innerText = `Bs. ${(totalSales * 0.70).toFixed(2)}`;

  const ctx = document.getElementById('financialChart').getContext('2d');
  if (window.myChart) window.myChart.destroy();
  window.myChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Plataforma (30%)', 'Usuarios (70%)'],
      datasets: [{ data: [totalSales * 0.30, totalSales * 0.70], backgroundColor: ['#a855f7', '#10b981'] }]
    }
  });
}

async function loadUserList() {
  const tbody = document.getElementById('userListTable');
  tbody.innerHTML = '';
  const { data } = await STATE.supabase.from('usuarios').select('*');
  (data || []).forEach(u => {
    tbody.innerHTML += `
      <tr class="border-b border-slate-800">
        <td class="p-3 font-bold">${u.username}</td>
        <td class="p-3">${u.gmail || '-'}</td>
        <td class="p-3">${u.cantidad_barajitas || 0}</td>
        <td class="p-3 text-emerald-400">Bs. ${u.saldo_bs || 0}</td>
        <td class="p-3 text-center">-</td>
      </tr>`;
  });
}

async function purgeAllData() {
  if (!confirm("⚠️ ¿Deseas purgar todas las transacciones y retiros del sistema?")) return;
  await STATE.supabase.from('transacciones').delete().neq('usuario_id', '');
  await STATE.supabase.from('retiros').delete().neq('usuario_id', '');
  window.location.reload();
}
function exitAdmin() {
  window.location.href = 'album.html';
}
