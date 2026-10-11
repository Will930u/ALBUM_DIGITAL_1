import os
import requests
from flask import Flask, request, jsonify
from flask_cors import CORS
from supabase import create_client, Client

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_ADMIN_CHAT_ID = os.environ.get("TELEGRAM_ADMIN_CHAT_ID", "")

supabase_client: Client = None
if SUPABASE_URL and SUPABASE_KEY:
    try:
        supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
    except Exception as e:
        print(f"Error al inicializar Supabase: {e}")

def send_telegram_message(chat_id: str, text: str):
    if not TELEGRAM_BOT_TOKEN or not chat_id:
        return False
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML"
    }
    try:
        res = requests.post(url, json=payload, timeout=10)
        return res.ok
    except Exception as e:
        print(f"Error notificando a Telegram: {e}")
        return False

@app.route("/", methods=["GET"])
def index():
    return jsonify({"status": "online", "service": "Álbum Digital Backend", "version": "2.1.0"}), 200

@app.route("/api/bcv", methods=["GET"])
def get_bcv_rate():
    try:
        res = requests.get("https://ve.dolarapi.com/v1/dolares/oficial", timeout=5)
        if res.ok:
            data = res.json()
            return jsonify({"status": "success", "promedio": data.get("promedio", 0)}), 200
        return jsonify({"status": "error", "message": "No se pudo obtener la tasa BCV"}), 502
    except Exception as e:
        return jsonify({"status": "error", "details": str(e)}), 500

@app.route("/api/notificar-compra", methods=["POST"])
def notificar_compra():
    data = request.get_json(silent=True) or {}
    usuario_id = data.get("usuario_id")
    barajitas_qty = data.get("barajitas_qty")
    monto_bs = data.get("monto_bs")
    monto_usd = data.get("monto_usd", 0.62)
    referencia = str(data.get("referencia", "")).strip()

    if not all([usuario_id, barajitas_qty, monto_bs, referencia]):
        return jsonify({"status": "error", "message": "Campos incompletos"}), 400

    if supabase_client:
        try:
            # Validar si la referencia ya existe para evitar fraude por reutilización
            existing = supabase_client.table("transacciones").select("id").eq("referencia", referencia).execute()
            if existing.data and len(existing.data) > 0:
                return jsonify({"status": "error", "message": "El número de referencia ya fue reportado anteriormente."}), 400

            # Registrar en transacciones
            supabase_client.table("transacciones").insert({
                "usuario_id": str(usuario_id),
                "barajitas_qty": int(barajitas_qty),
                "monto_bs": float(monto_bs),
                "monto_usd": float(monto_usd),
                "referencia": referencia,
                "estado": "pendiente"
            }).execute()

        except Exception as e:
            print(f"Error registrando compra en servidor: {e}")
            return jsonify({"status": "error", "message": "Error interno al registrar la compra"}), 500

    mensaje = (
        f"🛒 <b>NUEVA SOLICITUD DE COMPRA</b>\n\n"
        f"👤 <b>Usuario:</b> <code>{usuario_id}</code>\n"
        f"🎴 <b>Barajitas:</b> {barajitas_qty}\n"
        f"💰 <b>Monto:</b> Bs. {float(monto_bs):.2f}\n"
        f"🔢 <b>Referencia:</b> <code>{referencia}</code>"
    )
    sent = send_telegram_message(TELEGRAM_ADMIN_CHAT_ID, mensaje)

    return jsonify({"status": "success", "telegram_sent": sent}), 200

@app.route("/api/notificar-retiro", methods=["POST"])
def notificar_retiro():
    data = request.get_json(silent=True) or {}
    usuario_id = data.get("usuario_id")
    tipo = data.get("tipo", "hito_parcial")
    milestone = data.get("milestone", 0)
    monto_bs = data.get("monto_bs")
    monto_usd = data.get("monto_usd", 200.0)
    datos_pago = data.get("datos_pago")

    if not all([usuario_id, monto_bs, datos_pago]):
        return jsonify({"status": "error", "message": "Campos incompletos"}), 400

    if supabase_client:
        try:
            # Validar si ya tiene un retiro pendiente
            pending = supabase_client.table("retiros_premios").select("id").eq("usuario_id", str(usuario_id)).eq("estado", "pendiente").execute()
            if pending.data and len(pending.data) > 0:
                return jsonify({"status": "error", "message": "Ya posees una solicitud de retiro en proceso."}), 400

            supabase_client.table("retiros_premios").insert({
                "usuario_id": str(usuario_id),
                "tipo": str(tipo),
                "milestone": int(milestone),
                "monto_bs": float(monto_bs),
                "monto_usd": float(monto_usd),
                "datos_pago": str(datos_pago),
                "estado": "pendiente"
            }).execute()
        except Exception as e:
            print(f"Error registrando retiro: {e}")
            return jsonify({"status": "error", "message": "Error registrando solicitud"}), 500

    if tipo == "liquidacion_total":
        mensaje = f"🚨 <b>SOLICITUD DE LIQUIDACIÓN TOTAL</b>\n\n👤 <b>Usuario:</b> <code>{usuario_id}</code>\n💰 <b>Monto:</b> Bs. {float(monto_bs):.2f}\n📱 <b>Pago Móvil:</b> {datos_pago}"
    else:
        mensaje = f"🏆 <b>SOLICITUD DE PREMIO HITO (${milestone})</b>\n\n👤 <b>Usuario:</b> <code>{usuario_id}</code>\n🎯 <b>Hito:</b> Barajita #{milestone}\n💰 <b>Monto:</b> Bs. {float(monto_bs):.2f}\n📱 <b>Pago Móvil:</b> {datos_pago}"

    sent = send_telegram_message(TELEGRAM_ADMIN_CHAT_ID, mensaje)
    return jsonify({"status": "success", "telegram_sent": sent}), 200

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)