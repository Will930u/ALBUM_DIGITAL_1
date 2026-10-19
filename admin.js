const API_URL = "https://album-digital-1.onrender.com";

// Variable global para controlar el período activo de la gráfica de barras
let currentChartPeriod = 'diario';

// 🛡️ PANTALLA DE ÁREA RESTRINGIDA Y CIERRE DE SESIÓN
function mostrarAreaRestringida(mensaje = "⛔ ACCESO DENEGADO: Área restringida exclusivamente para administradores.") {
  document.body.innerHTML = `
    <div style="background-color: #080314; color: #f8fafc; font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; padding: 20px;">
      <div style="background: rgba(15, 23, 42, 0.9); border: 2px solid #ef4444; padding: 40px; border-radius: 20px; max-width: 500px; box-shadow: 0 10px 25px rgba(239, 68, 68, 0.3);">
        <div style="font-size: 60px; margin-bottom: 20px;">⚠️</div>
        <h1 style="color: #ef4444; font-size: 24px; margin-bottom: 15px; font-weight: bold;">ÁREA RESTRINGIDA</h1>
        <p style="color: #cbd5e1; font-size: 14px; margin-bottom: 25px; line-height: 1.5;">${mensaje}</p>
        <button onclick="window.location.href='album.html'" style="background: linear-gradient(to right, #991b1b, #7f1d1d); color: white; border: none; padding: 12px 24px; border-radius: 10px; font-weight: bold; cursor: pointer; font-size: 14px; transition: opacity 0.2s;">Regresar al Álbum</button>
      </div>
    </div>
  `;
}

function forceLogoutAndExit(mensaje = "Tu acceso ha sido revocado remotamente.") {
  localStorage.removeItem('active_user_id');
  mostrarAreaRestringida(mensaje);
}

// 🛡️ VALIDACIÓN DE SEGURIDAD INICIAL
document.addEventListener('DOMContentLoaded', async () => {
  const activeUserId = localStorage.getItem('active_user_id');
  
  if (!activeUserId) {
    window.location.href = 'index.html';
    return;
  }

  await checkAdminSessionSecurity(activeUserId);
});

async function checkAdminSessionSecurity(userId) {
  try {
    const response = await fetch(`${API_URL}/api/verificar-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario_id: userId })
    });
    
    const data = await response.json();
    
    if (response.status === 403 || data.status === 'blocked' || data.bloqueado === true) {
      mostrarAreaRestringida("🚨 ACCESO BLOQUEADO: Has intentado ingresar repetidamente a un área restringida. Tu cuenta ha sido bloqueada permanentemente.");
      localStorage.removeItem('active_user_id');
      return;
    }

    if (data.status === 'warning') {
      mostrarAreaRestringida(`⚠️ ÁREA RESTRINGIDA: No tienes permisos de administrador. Intento registrado (${data.intentos}/3).`);
      return;
    }

    if (data.status === 'unauthorized' || response.status === 403) {
      mostrarAreaRestringida("⛔ ÁREA RESTRINGIDA: Acceso no permitido.");
      return;
    }

    // Actualizar métricas automáticamente cada 2 segundos si la pestaña está activa
    setInterval(() => {
      const metricTab = document.getElementById('adminContentMetricas');
      if (metricTab && !metricTab.classList.contains('hidden')) {
        renderFinancialMetrics();
      }
    }, 2000);

  } catch (e) {
    console.error("Error en verificación de seguridad en vivo:", e);
  }
}

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

      const estaBloqueado = data.pago_bloqueado === true;
      const btnGuardar = document.getElementById('btnGuardarConfig');
      const inputs = ['cfgBanco', 'cfgTelefono', 'cfgCedula', 'cfgTitular'];
      const avisoBloqueo = document.getElementById('avisoBloqueoConfig');

      inputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = estaBloqueado;
      });

      if (btnGuardar) {
        btnGuardar.disabled = estaBloqueado;
        if (estaBloqueado) {
          btnGuardar.className = "w-full py-3 bg-slate-800 text-slate-500 font-bold rounded-xl text-sm cursor-not-allowed border border-red-500/30";
          btnGuardar.innerText = "🔒 CONFIGURACIÓN BLOQUEADA DESDE TELEGRAM";
        } else {
          btnGuardar.className = "w-full py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white font-bold rounded-xl text-sm transition hover:opacity-90";
          btnGuardar.innerText = "GUARDAR DATOS DE PAGO";
        }
      }

      if (avisoBloqueo) {
        avisoBloqueo.innerHTML = estaBloqueado 
          ? `<div class="p-3 bg-red-950/50 border border-red-500/40 rounded-xl text-xs text-red-300 text-center font-bold">🔒 Cerrojo Activo: Los datos de pago están protegidos contra modificaciones. Desbloquéalos desde tu bot de Telegram si necesitas editarlos.</div>`
          : `<div class="p-3 bg-emerald-950/50 border border-emerald-500/40 rounded-xl text-xs text-emerald-300 text-center font-bold">🔓 Cerrojo Abierto: Puedes editar y guardar los datos de pago.</div>`;
      }
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

    const resultado = await res.json();

    if (res.ok && resultado.success) {
      alert('¡Datos de pago de la plataforma actualizados con éxito!');
    } else {
      alert(resultado.error || 'Error al guardar la configuración (Posiblemente bloqueada por seguridad).');
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
          <td class="p-3">${w.tipo} (Hito #${w.milestone})</td>
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
  alert("La carga masiva de imágenes para las 1000 barajitas se gestiona directamente en el servidor seguro.");
}

// ==========================================
// CONTROL DE PERÍODO DE LA GRÁFICA DE BARRAS
// ==========================================
function changeChartPeriod(period) {
  currentChartPeriod = period;
  
  // Actualizar estilos de los botones del selector
  ['diario', 'semanal', 'mensual'].forEach(p => {
    const btn = document.getElementById(`btnChart${p.charAt(0).toUpperCase() + p.slice(1)}`);
    if (btn) {
      if (p === period) {
        btn.className = "py-1.5 rounded-lg text-[11px] font-bold bg-purple-600 text-white transition";
      } else {
        btn.className = "py-1.5 rounded-lg text-[11px] font-semibold text-slate-400 transition hover:text-white";
      }
    }
  });

  const labelTitle = document.getElementById('chartTitleLabel');
  if (labelTitle) {
    labelTitle.innerText = `Flujo de Transacciones - ${period.charAt(0).toUpperCase() + period.slice(1)}`;
  }

  renderFinancialMetrics();
}

// ==========================================
// FUNCIÓN DE LIMPIEZA DE MÉTRICAS OPERATIVAS
// ==========================================
async function clearOperationalMetrics() {
  if (!confirm("⚠️ ¿Estás seguro de que deseas limpiar y reiniciar las métricas operativas y la gráfica de movimientos? (Esto no afecta el total de usuarios registrados ni los usuarios en línea).")) return;

  try {
    const res = await fetch(`${API_URL}/api/admin/purgar`, { method: 'POST' });
    if (res.ok) {
      alert("✅ Métricas operativas y transacciones limpiadas con éxito.");
      renderFinancialMetrics();
    } else {
      alert("Error al limpiar las métricas en el servidor.");
    }
  } catch (err) {
    console.error("Error al limpiar métricas operativas:", err);
  }
}

async function renderFinancialMetrics() {
  try {
    const res = await fetch(`${API_URL}/api/admin/metricas`);
    const data = await res.json();
    
    const totalSalesBs = data.total_sales || 0;
    const bcvRate = data.bcv_rate || 1.0;
    const totalSalesUsd = bcvRate > 0 ? totalSalesBs / bcvRate : 0;
    
    const approvedCount = data.approved_count || 0;
    const stickersSold = data.stickers_sold || 0;
    const totalUsers = data.total_usuarios || 0;
    const onlineUsers = data.usuarios_online || 0;

    // Métricas intocables (Usuarios Totales y Activos)
    const elTotalUsers = document.getElementById('metricTotalUsers');
    const elOnlineUsers = document.getElementById('metricOnlineUsers');
    if (elTotalUsers) elTotalUsers.innerText = totalUsers;
    if (elOnlineUsers) elOnlineUsers.innerText = onlineUsers;

    const elSalesBs = document.getElementById('metricTotalSalesBs');
    const elSalesUsd = document.getElementById('metricTotalSalesUsd');
    if (elSalesBs) elSalesBs.innerText = `Bs. ${totalSalesBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (elSalesUsd) elSalesUsd.innerText = `($${totalSalesUsd.toFixed(2)} USD)`;

    const elProfitBs = document.getElementById('metricPlatformProfitBs');
    const elProfitUsd = document.getElementById('metricPlatformProfitUsd');
    if (elProfitBs) elProfitBs.innerText = `Bs. ${(totalSalesBs * 0.30).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (elProfitUsd) elProfitUsd.innerText = `($${(totalSalesUsd * 0.30).toFixed(2)} USD)`;

    const elNetBs = document.getElementById('metricUserNetValueBs');
    const elNetUsd = document.getElementById('metricUserNetValueUsd');
    if (elNetBs) elNetBs.innerText = `Bs. ${(totalSalesBs * 0.70).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (elNetUsd) elNetUsd.innerText = `($${(totalSalesUsd * 0.70).toFixed(2)} USD)`;

    const elCountApp = document.getElementById('metricCountApproved');
    const elStickers = document.getElementById('metricTotalStickersSold');
    const elBcv = document.getElementById('metricBcvReference');
    if (elCountApp) elCountApp.innerText = approvedCount;
    if (elStickers) elStickers.innerText = stickersSold;
    if (elBcv) elBcv.innerText = `Bs. ${bcvRate.toFixed(2)}`;

    // ==========================================
    // RENDERIZADO DE LA GRÁFICA DE BARRAS (DIARIO / SEMANAL / MENSUAL)
    // ==========================================
    const chartCanvas = document.getElementById('financialChart');
    if (chartCanvas) {
      const ctx = chartCanvas.getContext('2d');
      if (window.myChart) window.myChart.destroy();
      
      // Datos simulados/agrupados según el período seleccionado para la gráfica de barras
      let chartLabels = [];
      let chartDataValues = [];

      if (currentChartPeriod === 'diario') {
        chartLabels = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
        // Distribuir el total o mostrar valores basados en la caja actual
        chartDataValues = [totalSalesBs * 0.1, totalSalesBs * 0.15, totalSalesBs * 0.08, totalSalesBs * 0.2, totalSalesBs * 0.22, totalSalesBs * 0.15, totalSalesBs * 0.1];
      } else if (currentChartPeriod === 'semanal') {
        chartLabels = ['Semana 1', 'Semana 2', 'Semana 3', 'Semana 4'];
        chartDataValues = [totalSalesBs * 0.2, totalSalesBs * 0.3, totalSalesBs * 0.25, totalSalesBs * 0.25];
      } else {
        chartLabels = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        chartDataValues = new Array(12).fill(totalSalesBs / 12);
      }

      window.myChart = new Chart(ctx, {
        type: 'bar', // Gráfica de barras solicitada
        data: {
          labels: chartLabels,
          datasets: [{
            label: 'Volumen de Transacciones (Bs.)',
            data: chartDataValues,
            backgroundColor: 'rgba(168, 85, 247, 0.7)',
            borderColor: '#a855f7',
            borderWidth: 1,
            borderRadius: 8
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false }
          },
          scales: {
            x: {
              grid: { color: 'rgba(255, 255, 255, 0.05)' },
              ticks: { color: '#94a3b8', font: { size: 10 } }
            },
            y: {
              grid: { color: 'rgba(255, 255, 255, 0.05)' },
              ticks: { color: '#94a3b8', font: { size: 10 } }
            }
          }
        }
      });
    }

  } catch (err) {
    console.error('Error cargando métricas analíticas:', err);
  }
}

async function loadUserList() {
  const tbody = document.getElementById('userListTable');
  tbody.innerHTML = '';
  try {
    const res = await fetch(`${API_URL}/api/admin/usuarios`);
    const data = await res.json();
    
    if (!data || data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-500">No hay usuarios registrados.</td></tr>`;
      return;
    }

    data.forEach(u => {
      const fechaAceptacion = u.fecha_aceptacion ? new Date(u.fecha_aceptacion).toLocaleString() : 'No registrada';
      const estaBloqueado = u.bloqueado === true;
      
      const estadoHtml = estaBloqueado 
        ? `<span class="px-2 py-1 bg-red-900/50 text-red-300 border border-red-500/40 rounded text-xs font-bold">Bloqueado</span>
           <button onclick="toggleUserStatus('${u.id}', false)" class="ml-2 px-2 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs transition">Desbloquear</button>`
        : `<span class="px-2 py-1 bg-emerald-900/50 text-emerald-300 border border-emerald-500/40 rounded text-xs font-bold">Activo</span>
           <button onclick="toggleUserStatus('${u.id}', true)" class="ml-2 px-2 py-1 bg-red-600 hover:bg-red-500 text-white rounded text-xs transition">Bloquear</button>`;

      tbody.innerHTML += `
        <tr class="border-b border-slate-800">
          <td class="p-3 font-bold">${u.username}</td>
          <td class="p-3">${u.gmail || '-'}</td>
          <td class="p-3">${u.cantidad_barajitas || 0} / 1000</td>
          <td class="p-3 text-emerald-400">Bs. ${u.saldo_bs || 0}</td>
          <td class="p-3 text-xs text-purple-300 font-mono">📅 ${fechaAceptacion}</td>
          <td class="p-3 text-center">${estadoHtml}</td>
        </tr>`;
    });
  } catch (err) {
    console.error('Error cargando usuarios:', err);
  }
}

async function toggleUserStatus(userId, bloquear) {
  const accionTexto = bloquear ? "bloquear" : "desbloquear";
  if (!confirm(`¿Estás seguro de que deseas ${accionTexto} al usuario ${userId}?`)) return;

  try {
    const res = await fetch(`${API_URL}/api/admin/toggle-bloqueo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario_id: userId, bloquear: bloquear })
    });
    if (res.ok) {
      loadUserList();
    } else {
      alert("Error al actualizar el estado del usuario.");
    }
  } catch (err) {
    console.error('Error en toggleUserStatus:', err);
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
