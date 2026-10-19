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
