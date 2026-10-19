const API_URL = "https://album-digital-1.onrender.com";
const STATE = {
  bcvRate: 36.5,
  userId: localStorage.getItem('active_user_id') || null
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
    
    const today = new Date().toISOString().split('T')[0];
    const dateField = document.getElementById('dateInput');
    if (dateField) dateField.value = today;
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

function calculateTotal() {
  const qty = parseInt(document.getElementById('stickerQty').value) || 0;
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
  const phone = document.getElementById('phoneInput').value.trim();
  const bank = document.getElementById('bankInput').value.trim();
  const ref = document.getElementById('refInput').value.trim();
  const fechaPago = document.getElementById('dateInput').value;
  const btnSubmit = document.getElementById('btnSubmitPurchase');

  if (qty <= 0 || !phone || !bank || !ref || !fechaPago) {
    alert('Por favor completa todos los campos del formulario de pago.');
    return;
  }

  const totalUSD = qty * 0.62;
  const totalBs = totalUSD * STATE.bcvRate;
  btnSubmit.disabled = true;
  btnSubmit.innerText = "REPORTANDO...";

  try {
    const res = await fetch(`${API_URL}/api/notificar-compra`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usuario_id: STATE.userId,
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
      alert('Error: ' + (data.message || 'No se pudo reportar el pago'));
      btnSubmit.disabled = false;
      btnSubmit.innerText = "REPORTAR PAGO Y SOLICITAR BARAJITAS";
      return;
    }

    alert('¡Pago reportado con éxito! En revisión.');
    window.location.href = 'album.html';
  } catch (err) {
    console.error(err);
    alert('Error de conexión con el servidor.');
    btnSubmit.disabled = false;
    btnSubmit.innerText = "REPORTAR PAGO Y SOLICITAR BARAJITAS";
  }
}
