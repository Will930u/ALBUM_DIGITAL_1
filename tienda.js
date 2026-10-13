const API_URL = "https://album-digital-1.onrender.com";
const SUPABASE_URL = "https://dxicbitnnesjsqzxisea.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4aWNiaXRubmVzanNxenhpc2VhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0MTQzMTMsImV4cCI6MjEwNjk5MDMxM30.0xUXIa0Bby7xpJAF_N3y-n_H3SPwVlUBb9m630AFPtw";

const STATE = {
  bcvRate: 36.5,
  userId: localStorage.getItem('active_user_id') || null,
  supabase: supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
};

document.addEventListener('DOMContentLoaded', async () => {
  if (!STATE.userId) {
    window.location.href = 'index.html';
    return;
  }
  try {
    lucide.createIcons();
    await fetchBcvRate();
  } catch (err) {
    console.error("Error al inicializar la tienda:", err);
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

async function submitPurchase(e) {
  e.preventDefault();
  const qty = parseInt(document.getElementById('stickerQty').value) || 0;
  const ref = document.getElementById('refInput').value.trim();
  const btnSubmit = document.getElementById('btnSubmitPurchase');

  if (qty <= 0 || !ref) {
    alert('Ingresa cantidad y referencia válida.');
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
        referencia: ref
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
    document.getElementById('refInput').value = '';
    window.location.href = 'album.html';
  } catch (err) {
    console.error(err);
    alert('Error de conexión con el servidor.');
    btnSubmit.disabled = false;
    btnSubmit.innerText = "REPORTAR PAGO Y SOLICITAR BARAJITAS";
  }
}
