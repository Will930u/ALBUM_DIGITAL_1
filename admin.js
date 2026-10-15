const API_URL = "https://album-digital-1.onrender.com";

// 🛡️ VALIDACIÓN DE SEGURIDAD EXCLUSIVA CONECTADA AL BACKEND Y SUPABASE
document.addEventListener('DOMContentLoaded', async () => {
  const activeUserId = localStorage.getItem('active_user_id');
  
  if (!activeUserId) {
    window.location.href = 'index.html';
    return;
  }

  try {
    // Consultamos al backend para que verifique de forma oficial en Supabase
    const response = await fetch(`${API_URL}/api/verificar-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario_id: activeUserId })
    });
    
    const data = await response.json();
    
    // Si el servidor confirma en Supabase que es el administrador autorizado (status 200)
    if (response.status === 200 && data.status === 'authorized') {
      if (typeof switchAdminTab === 'function') {
        switchAdminTab('pagos');
      }
      return;
    }

    // Si el backend responde con advertencia (Intento 1 o 2 por link directo)
    if (data.status === 'warning') {
      document.body.innerHTML = `
        <div style="background-color: #020617; color: #ffffff; min-height: 100vh; display: flex; align-items: center; justify-content: center; font-family: sans-serif;">
          <div style="text-align: center; padding: 2rem; background: #090d16; border: 1px solid #1e293b; border-radius: 1rem; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);">
            <h2 style="font-size: 1.25rem; font-weight: bold; color: #fbbf24; margin-bottom: 0.5rem;">⚠️ Advertencia de Seguridad (${data.intentos}/3)</h2>
            <p style="font-size: 0.875rem; color: #94a3b8;">Intento de acceso no autorizado registrado. Redirigiendo a tu álbum...</p>
          </div>
        </div>
      `;

      setTimeout(() => {
        window.location.href = 'album.html';
      }, 2500);
      return;
    }

    // Si llega al tercer intento o está bloqueado (status 403 o blocked)
    if (response.status === 403 || data.status === 'blocked') {
      document.body.innerHTML = `
        <div style="background-color: #020617; color: #ffffff; min-height: 100vh; display: flex; align-items: center; justify-content: center; font-family: sans-serif;">
          <div style="text-align: center; padding: 2rem; background: #090d16; border: 1px solid #1e293b; border-radius: 1rem; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);">
            <h2 style="font-size: 1.25rem; font-weight: bold; color: #f87171; margin-bottom: 0.5rem;">🚨 ¡Cuenta Bloqueada Permanentemente!</h2>
            <p style="font-size: 0.875rem; color: #94a3b8;">Alcanzaste el límite de intentos no autorizados. Cerrando sesión...</p>
          </div>
        </div>
      `;

      setTimeout(() => {
        localStorage.removeItem('active_user_id');
        window.location.href = 'index.html';
      }, 3000);
      return;
    }

  } catch (e) {
    console.error("Error en validación de admin:", e);
    window.location.href = 'album.html';
    return;
  }

  // Por seguridad predeterminada si hay respuestas inesperadas
  window.location.href = 'album.html';
});
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
  try {
    const res = await fetch(`${API_URL}/api/admin/configuracion`);
    const data = await res.json();
    if (data) {
      document.getElementById('cfgBanco').value = data.banco || '';
      document.getElementById('cfgTelefono').value = data.telefono || '';
      document.getElementById('cfgCedula').value = data.cedula || '';
      document.getElementById('cfgTitular').value = data.titular || '';
    }
  } catch (err) {
    console.error('Error al cargar configuración:', err);
  }
}

async function savePlatformConfig(e) {
  e.preventDefault();
  const banco = document.getElementById('cfgBanco').value.trim();
  const telefono = document.getElementById('cfgTelefono').value.trim();
  const cedula = document.getElementById('cfgCedula').value.trim();
  const titular = document.getElementById('cfgTitular').value.trim();

  try {
    const res = await fetch(`${API_URL}/api/admin/configuracion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ banco, telefono, cedula, titular })
    });

    if (res.ok) {
      alert('¡Datos de pago de la plataforma actualizados con éxito!');
    } else {
      alert('Error al guardar la configuración.');
    }
  } catch (err) {
    console.error('Error:', err);
  }
}

async function loadPendingPayments() {
  const tbody = document.getElementById('pendingPaymentsTable');
  tbody.innerHTML = '';
  try {
    const res = await fetch(`${API_URL}/api/admin/pagos-pendientes`);
    const data = await res.json();

    if (!data || data.length === 0) {
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
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-red-500">Error al cargar pagos pendientes.</td></tr>`;
  }
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
  try {
    const res = await fetch(`${API_URL}/api/admin/retiros-pendientes`);
    const data = await res.json();
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
  } catch (err) {
    console.error('Error al cargar retiros:', err);
  }
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
  alert("La carga masiva de imágenes se gestiona directamente en el servidor seguro.");
}

async function renderFinancialMetrics() {
  try {
    const res = await fetch(`${API_URL}/api/admin/metricas`);
    const data = await res.json();
    const totalSales = data.total_sales || 0;

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
  } catch (err) {
    console.error('Error cargando métricas:', err);
  }
}

async function loadUserList() {
  const tbody = document.getElementById('userListTable');
  tbody.innerHTML = '';
  try {
    const res = await fetch(`${API_URL}/api/admin/usuarios`);
    const data = await res.json();
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
  } catch (err) {
    console.error('Error cargando usuarios:', err);
  }
}

async function purgeAllData() {
  if (!confirm("⚠️ ¿Deseas purgar todas las transacciones y retiros del sistema?")) return;
  try {
    await fetch(`${API_URL}/api/admin/purgar`, { method: 'POST' });
    window.location.reload();
  } catch (err) {
    console.error('Error al purgar datos:', err);
  }
}

function exitAdmin() {
  window.location.href = 'album.html';
}
