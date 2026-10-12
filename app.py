import os
import requests
from flask import Flask, request, jsonify
from flask_cors import CORS
from supabase import create_client, Client

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").strip()
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "").strip()
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
TELEGRAM_ADMIN_CHAT_ID = os.environ.get("TELEGRAM_ADMIN_CHAT_ID", "").strip()

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
    return jsonify({"status": "online", "service": "Álbum Digital Backend", "version": "2.6.0"}), 200

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
            existing = supabase_client.table("transacciones").select("id").eq("referencia", referencia).execute()
            if existing.data and len(existing.data) > 0:
                return jsonify({"status": "error", "message": "La referencia ya fue reportada."}), 400

            supabase_client.table("transacciones").insert({
                "usuario_id": str(usuario_id),
                "barajitas_qty": int(barajitas_qty),
                "monto_bs": float(monto_bs),
                "monto_usd": float(monto_usd),
                "referencia": referencia,
                "estado": "pendiente"
            }).execute()
        except Exception as e:
            return jsonify({"status": "error", "message": str(e)}), 500

    mensaje = (
        f"🛒 <b>NUEVA SOLICITUD DE COMPRA</b>\n\n"
        f"👤 <b>Usuario:</b> <code>{usuario_id}</code>\n"
        f"🎴 <b>Barajitas:</b> {barajitas_qty}\n"
        f"💰 <b>Monto Bs.:</b> {float(monto_bs):.2f}\n"
        f"🔢 <b>Referencia:</b> <code>{referencia}</code>"
    )
    sent = send_telegram_message(TELEGRAM_ADMIN_CHAT_ID, mensaje)
    return jsonify({"status": "success", "telegram_sent": sent}), 200

@app.route("/api/procesar-compra-admin", methods=["POST"])
def procesar_compra_admin():
    data = request.get_json(silent=True) or {}
    tx_id = data.get("tx_id")
    accion = data.get("accion")
    
    if not tx_id or not accion:
        return jsonify({"status": "error", "message": "Datos incompletos"}), 400

    if supabase_client:
        try:
            tx_res = supabase_client.table("transacciones").select("*").eq("id", tx_id).single()
            tx = tx_res.data
            if not tx:
                return jsonify({"status": "error", "message": "Transacción no encontrada"}), 404

            nuevo_estado = "aprobado" if accion == "aprobar" else "rechazado"
            supabase_client.table("transacciones").update({"estado": nuevo_estado}).eq("id", tx_id).execute()

            if accion == "aprobar":
                usr_res = supabase_client.table("usuarios").select("*").eq("id", tx["usuario_id"]).single()
                usr = usr_res.data
                if usr:
                    nueva_cantidad = (usr.get("cantidad_barajitas") or 0) + tx["barajitas_qty"]
                    nuevo_saldo = (usr.get("saldo_bs") or 0.0) + (float(tx["monto_bs"]) * 0.70)
                    supabase_client.table("usuarios").update({
                        "cantidad_barajitas": nueva_cantidad,
                        "saldo_bs": nuevo_saldo
                    }).eq("id", tx["usuario_id"]).execute()

            icono = "✅" if accion == "aprobar" else "❌"
            msg = (
                f"{icono} <b>COMPRA {accion.upper()}A</b>\n\n"
                f"👤 <b>Usuario:</b> <code>{tx['usuario_id']}</code>\n"
                f"🎴 <b>Barajitas:</b> {tx['barajitas_qty']}\n"
                f"💰 <b>Monto Bs.:</b> {float(tx['monto_bs']):.2f}\n"
                f"🔢 <b>Referencia:</b> <code>{tx['referencia']}</code>"
            )
            send_telegram_message(TELEGRAM_ADMIN_CHAT_ID, msg)
            return jsonify({"status": "success"}), 200
        except Exception as e:
            return jsonify({"status": "error", "message": str(e)}), 500
    return jsonify({"status": "error", "message": "Sin conexión a BD"}), 500

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
            supabase_client.table("retiros").insert({
                "usuario_id": str(usuario_id),
                "tipo": str(tipo),
                "milestone": int(milestone),
                "monto_bs": float(monto_bs),
                "monto_usd": float(monto_usd),
                "datos_pago": str(datos_pago),
                "estado": "pendiente"
            }).execute()
        except Exception as e:
            return jsonify({"status": "error", "message": str(e)}), 500

    if tipo == "liquidacion_total":
        mensaje = f"🚨 <b>SOLICITUD DE LIQUIDACIÓN TOTAL</b>\n\n👤 <b>Usuario:</b> <code>{usuario_id}</code>\n💰 <b>Monto Bs.:</b> {float(monto_bs):.2f}\n📱 <b>Pago Móvil:</b> {datos_pago}"
    else:
        mensaje = f"🏆 <b>SOLICITUD DE PREMIO HITO (#{milestone})</b>\n\n👤 <b>Usuario:</b> <code>{usuario_id}</code>\n💰 <b>Monto Bs.:</b> {float(monto_bs):.2f}\n📱 <b>Pago Móvil:</b> {datos_pago}"

    sent = send_telegram_message(TELEGRAM_ADMIN_CHAT_ID, mensaje)
    return jsonify({"status": "success", "telegram_sent": sent}), 200

@app.route("/api/procesar-retiro-admin", methods=["POST"])
def procesar_retiro_admin():
    data = request.get_json(silent=True) or {}
    w_id = data.get("w_id")
    accion = data.get("accion")

    if not w_id or not accion:
        return jsonify({"status": "error", "message": "Datos incompletos"}), 400

    if supabase_client:
        try:
            w_res = supabase_client.table("retiros").select("*").eq("id", w_id).single()
            w = w_res.data
            if not w:
                return jsonify({"status": "error", "message": "Retiro no encontrado"}), 404

            nuevo_estado = "aprobado" if accion == "aprobar" else "rechazado"
            supabase_client.table("retiros").update({"estado": nuevo_estado}).eq("id", w_id).execute()

            if accion == "aprobar":
                usr_res = supabase_client.table("usuarios").select("*").eq("id", w["usuario_id"]).single()
                usr = usr_res.data
                if usr:
                    if w["tipo"] == "liquidacion_total" or w["milestone"] == 2000:
                        supabase_client.table("usuarios").update({
                            "cantidad_barajitas": 0,
                            "saldo_bs": 0.0,
                            "retiros_premios": []
                        }).eq("id", w["usuario_id"]).execute()
                    else:
                        claimed = usr.get("retiros_premios") or []
                        if w["milestone"] not in claimed:
                            claimed.append(w["milestone"])
                        nuevo_saldo = max(0.0, (usr.get("saldo_bs") or 0.0) - float(w["monto_bs"]))
                        supabase_client.table("usuarios").update({
                            "saldo_bs": nuevo_saldo,
                            "retiros_premios": claimed
                        }).eq("id", w["usuario_id"]).execute()

            icono = "✅" if accion == "aprobar" else "❌"
            msg = (
                f"{icono} <b>RETIRO / HITO {accion.upper()}O</b>\n\n"
                f"👤 <b>Usuario:</b> <code>{w['usuario_id']}</code>\n"
                f"🎯 <b>Tipo:</b> {w['tipo']} (Hito #{w['milestone']})\n"
                f"💰 <b>Monto USD:</b> ${w['monto_usd']}"
            )
            send_telegram_message(TELEGRAM_ADMIN_CHAT_ID, msg)
            return jsonify({"status": "success"}), 200
        except Exception as e:
            return jsonify({"status": "error", "message": str(e)}), 500
    return jsonify({"status": "error", "message": "Sin conexión"}), 500

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
