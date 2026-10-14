import os
import threading
import requests
from flask import Flask, request, jsonify
from flask_cors import CORS
from supabase import create_client, Client

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").strip()
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip() or os.environ.get("SUPABASE_KEY", "").strip()
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
TELEGRAM_ADMIN_CHAT_ID = os.environ.get("TELEGRAM_ADMIN_CHAT_ID", "").strip()

ADMIN_USER_ID = "USR-UTRERA930"

supabase_client: Client = None
if SUPABASE_URL and SUPABASE_KEY:
    try:
        supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
    except Exception as e:
        print(f"Error al inicializar Supabase: {e}")

def _send_telegram_async(chat_id: str, text: str, reply_markup=None):
    if not TELEGRAM_BOT_TOKEN or not chat_id:
        return
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML"
    }
    if reply_markup:
        payload["reply_markup"] = reply_markup

    try:
        requests.post(url, json=payload, timeout=15)
    except Exception as e:
        print(f"❌ [TELEGRAM ERROR]: {e}")

def send_telegram_message(chat_id: str, text: str, reply_markup=None):
    if not TELEGRAM_BOT_TOKEN or not chat_id:
        return False
    thread = threading.Thread(target=_send_telegram_async, args=(chat_id, text, reply_markup))
    thread.daemon = True
    thread.start()
    return True

@app.route("/", methods=["GET"])
def index():
    return jsonify({"status": "online", "service": "Álbum Digital Backend", "version": "3.2.0"}), 200

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

# ==========================================
# ENDPOINTS DE AUTENTICACIÓN Y USUARIO
# ==========================================

@app.route("/api/login", methods=["POST"])
def api_login():
    data = request.get_json(silent=True) or {}
    username = str(data.get("username", "")).strip()
    password = str(data.get("password", "")).strip()

    if not username or not password or not supabase_client:
        return jsonify({"success": False, "message": "Datos incompletos o sin BD"}), 400

    try:
        res = supabase_client.table("usuarios").select("*").eq("username", username).execute()
        user = res.data[0] if res.data and len(res.data) > 0 else None

        if not user or user.get("password_hash") != password:
            return jsonify({"success": False, "message": "Usuario o contraseña incorrectos"}), 401

        if user.get("bloqueado") is True:
            return jsonify({"success": False, "bloqueado": True, "message": "Cuenta bloqueada"}), 403

        return jsonify({"success": True, "user_id": user.get("id")}), 200
    except Exception as e:
        print(f"Error en login: {e}")
        return jsonify({"success": False, "message": str(e)}), 500

@app.route("/api/recovery", methods=["POST"])
def api_recovery():
    data = request.get_json(silent=True) or {}
    username = str(data.get("username", "")).strip()
    email = str(data.get("email", "")).strip()
    telefono = str(data.get("telefono", "")).strip()

    if not supabase_client:
        return jsonify({"success": False}), 500

    try:
        res = supabase_client.table("usuarios").select("*").eq("username", username).execute()
        user = res.data[0] if res.data and len(res.data) > 0 else None
        
        if user and user.get("gmail", "").lower() == email.lower() and user.get("telefono", "").strip() == telefono.strip():
            return jsonify({"success": True}), 200
        return jsonify({"success": False}), 400
    except Exception as e:
        print(f"Error en recovery: {e}")
        return jsonify({"success": False, "message": str(e)}), 500

import traceback

@app.route("/api/usuario/info", methods=["POST"])
def api_usuario_info():
    data = request.get_json(silent=True) or {}
    usuario_id = str(data.get("usuario_id", "")).strip()

    if not supabase_client or not usuario_id:
        return jsonify({"error": "Datos incompletos"}), 400

    try:
        user_res = supabase_client.table("usuarios").select("*").eq("id", usuario_id).execute()
        user_data = user_res.data[0] if user_res.data and len(user_res.data) > 0 else None

        retiros_res = supabase_client.table("retiros").select("*").eq("usuario_id", usuario_id).execute()
        
        return jsonify({
            "user": user_data,
            "retiros": retiros_res.data or []
        }), 200
    except Exception as e:
        print("❌ Error detallado en /api/usuario/info:")
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route("/api/admin/configuracion", methods=["GET", "POST"])
def admin_configuracion():
    if not supabase_client:
        return jsonify({"error": "BD no disponible"}), 500

    if request.method == "GET":
        try:
            res = supabase_client.table("configuracion").select("*").limit(1).execute()
            config_data = res.data[0] if res.data and len(res.data) > 0 else {}
            return jsonify(config_data), 200
        except Exception as e:
            print(f"Error en config GET: {e}")
            return jsonify({"error": str(e)}), 500
    
    elif request.method == "POST":
        data = request.get_json(silent=True) or {}
        try:
            supabase_client.table("configuracion").upsert({
                "id": 1,
                "banco": data.get("banco"),
                "telefono": data.get("telefono"),
                "cedula": data.get("cedula"),
                "titular": data.get("titular")
            }).execute()
            return jsonify({"success": True}), 200
        except Exception as e:
            print(f"Error en config POST: {e}")
            return jsonify({"error": str(e)}), 500

@app.route("/api/register", methods=["POST"])
def api_register():
    data = request.get_json(silent=True) or {}
    username = str(data.get("username", "")).strip()
    email = str(data.get("email", "")).strip()
    password = str(data.get("password", "")).strip()
    banco = str(data.get("banco", "")).strip()
    cedula = str(data.get("cedula", "")).strip()
    telefono = str(data.get("telefono", "")).strip()

    if not all([username, email, password]):
        return jsonify({"error": "Faltan campos obligatorios"}), 400

    user_id = f"USR-{username.upper()}"

    if not supabase_client:
        return jsonify({"error": "Error de base de datos"}), 500

    try:
        supabase_client.table("usuarios").insert([{
            "id": user_id,
            "username": username,
            "password_hash": password,
            "gmail": email,
            "banco": banco,
            "cedula": cedula,
            "telefono": telefono,
            "cantidad_barajitas": 0,
            "saldo_bs": 0.0
        }]).execute()
        return jsonify({"success": True}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@app.route("/api/recovery", methods=["POST"])
def api_recovery():
    data = request.get_json(silent=True) or {}
    username = str(data.get("username", "")).strip()
    email = str(data.get("email", "")).strip()
    telefono = str(data.get("telefono", "")).strip()

    if not supabase_client:
        return jsonify({"success": False}), 500

    try:
        res = supabase_client.table("usuarios").select("*").eq("username", username).maybeSingle().execute()
        user = res.data
        if user and user.get("gmail", "").lower() == email.lower() and user.get("telefono", "").strip() == telefono.strip():
            return jsonify({"success": True}), 200
        return jsonify({"success": False}), 400
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500

@app.route("/api/usuario/info", methods=["POST"])
def api_usuario_info():
    data = request.get_json(silent=True) or {}
    usuario_id = str(data.get("usuario_id", "")).strip()

    if not supabase_client or not usuario_id:
        return jsonify({"error": "Datos incompletos"}), 400

    try:
        user_res = supabase_client.table("usuarios").select("*").eq("id", usuario_id).maybeSingle().execute()
        retiros_res = supabase_client.table("retiros").select("*").eq("usuario_id", usuario_id).execute()
        
        return jsonify({
            "user": user_res.data,
            "retiros": retiros_res.data or []
        }), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ==========================================
# ENDPOINTS DEL PANEL ADMINISTRADOR
# ==========================================

@app.route("/api/verificar-admin", methods=["POST"])
def verificar_admin():
    data = request.get_json(silent=True) or {}
    usuario_id = str(data.get("usuario_id", "")).strip()

    if usuario_id == ADMIN_USER_ID:
        return jsonify({"status": "authorized"}), 200

    if supabase_client:
        try:
            usr_res = supabase_client.table("usuarios").select("*").eq("id", usuario_id).execute()
            if usr_res.data and len(usr_res.data) > 0:
                usr = usr_res.data[0]
                if usr.get("bloqueado", False):
                    return jsonify({"status": "blocked", "message": "Cuenta bloqueada."}), 403

                intentos_actuales = (usr.get("intentos_admin") or 0) + 1
                
                if intentos_actuales >= 3:
                    supabase_client.table("usuarios").update({
                        "intentos_admin": intentos_actuales,
                        "bloqueado": True
                    }).eq("id", usuario_id).execute()

                    alerta_msg = (
                        f"🚨 <b>¡CUENTA BLOQUEADA PERMANENTEMENTE!</b>\n\n"
                        f"👤 <b>Usuario Reincidente:</b> <code>{usuario_id}</code>\n"
                        f"⚠️ Alcanzó el límite de 3 intentos de acceso no autorizado."
                    )
                    keyboard = {
                        "inline_keyboard": [
                            [{"text": "🔓 Desbloquear Usuario", "callback_data": f"desbloquear_{usuario_id}"}]
                        ]
                    }
                    send_telegram_message(TELEGRAM_ADMIN_CHAT_ID, alerta_msg, reply_markup=keyboard)
                    return jsonify({"status": "blocked", "message": "Cuenta bloqueada."}), 403
                else:
                    supabase_client.table("usuarios").update({
                        "intentos_admin": intentos_actuales
                    }).eq("id", usuario_id).execute()

                    alerta_msg = (
                        f"⚠️ <b>INTENTO DE ACCESO AL ADMIN (Advertencia #{intentos_actuales}/3)</b>\n\n"
                        f"👤 <b>Usuario:</b> <code>{usuario_id}</code>"
                    )
                    send_telegram_message(TELEGRAM_ADMIN_CHAT_ID, alerta_msg)
                    return jsonify({"status": "unauthorized", "message": "Acceso denegado."}), 403
        except Exception as e:
            print(f"Error: {e}")

    return jsonify({"status": "unauthorized"}), 403

@app.route("/api/admin/configuracion", methods=["GET", "POST"])
def admin_configuracion():
    if not supabase_client:
        return jsonify({"error": "BD no disponible"}), 500

    if request.method == "GET":
        try:
            res = supabase_client.table("configuracion").select("*").limit(1).maybeSingle().execute()
            return jsonify(res.data or {}), 200
        except Exception as e:
            return jsonify({"error": str(e)}), 500
    
    elif request.method == "POST":
        data = request.get_json(silent=True) or {}
        try:
            supabase_client.table("configuracion").upsert({
                "id": 1,
                "banco": data.get("banco"),
                "telefono": data.get("telefono"),
                "cedula": data.get("cedula"),
                "titular": data.get("titular")
            }).execute()
            return jsonify({"success": True}), 200
        except Exception as e:
            return jsonify({"error": str(e)}), 500

@app.route("/api/admin/pagos-pendientes", methods=["GET"])
def admin_pagos_pendientes():
    if not supabase_client:
        return jsonify([]), 200
    try:
        res = supabase_client.table("transacciones").select("*").eq("estado", "pendiente").order("created_at", desc=True).execute()
        return jsonify(res.data or []), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/admin/retiros-pendientes", methods=["GET"])
def admin_retiros_pendientes():
    if not supabase_client:
        return jsonify([]), 200
    try:
        res = supabase_client.table("retiros").select("*").eq("estado", "pendiente").order("created_at", desc=True).execute()
        return jsonify(res.data or []), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/admin/metricas", methods=["GET"])
def admin_metricas():
    if not supabase_client:
        return jsonify({"total_sales": 0}), 200
    try:
        res = supabase_client.table("transacciones").select("*").eq("estado", "aprobado").execute()
        total_sales = sum([float(t.get("monto_bs") or t.get("monto") or 0) for t in (res.data or [])])
        return jsonify({"total_sales": total_sales}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/admin/usuarios", methods=["GET"])
def admin_usuarios():
    if not supabase_client:
        return jsonify([]), 200
    try:
        res = supabase_client.table("usuarios").select("*").execute()
        return jsonify(res.data or []), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/admin/purgar", methods=["POST"])
def admin_purgar():
    if not supabase_client:
        return jsonify({"error": "BD no disponible"}), 500
    try:
        supabase_client.table("transacciones").delete().neq("usuario_id", "").execute()
        supabase_client.table("retiros").delete().neq("usuario_id", "").execute()
        return jsonify({"success": True}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/notificar-compra", methods=["POST"])
def notificar_compra():
    data = request.get_json(silent=True) or {}
    usuario_id = data.get("usuario_id")
    barajitas_qty = data.get("barajitas_qty")
    monto_bs = data.get("monto_bs")
    monto_usd = data.get("monto_usd", 0.62)
    referencia = str(data.get("referencia", "")).strip()
    telefono = str(data.get("telefono", "")).strip()
    banco = str(data.get("banco", "")).strip()
    fecha_pago = str(data.get("fecha_pago", "")).strip()

    if not all([usuario_id, barajitas_qty, monto_bs, referencia]):
        return jsonify({"status": "error", "message": "Campos incompletos"}), 400

    tx_id = None
    if supabase_client:
        try:
            res_insert = supabase_client.table("transacciones").insert({
                "usuario_id": str(usuario_id),
                "barajitas_qty": int(barajitas_qty),
                "monto_bs": float(monto_bs),
                "monto_usd": float(monto_usd),
                "monto": float(monto_bs),
                "referencia": referencia,
                "telefono": telefono,
                "banco": banco,
                "fecha_pago": fecha_pago,
                "estado": "pendiente"
            }).execute()
            if res_insert.data and len(res_insert.data) > 0:
                tx_id = res_insert.data[0].get("id")
        except Exception as e:
            return jsonify({"status": "error", "message": str(e)}), 500

    mensaje = (
        f"🛒 <b>NUEVA SOLICITUD DE COMPRA</b>\n\n"
        f"👤 <b>Usuario:</b> <code>{usuario_id}</code>\n"
        f"🎴 <b>Barajitas:</b> {barajitas_qty}\n"
        f"💰 <b>Monto Bs.:</b> {float(monto_bs):.2f}\n"
        f"🔢 <b>Referencia:</b> <code>{referencia}</code>"
    )
    
    keyboard = {
        "inline_keyboard": [
            [
                {"text": "✅ Aprobar", "callback_data": f"compra_aprobar_{tx_id}"},
                {"text": "❌ Rechazar", "callback_data": f"compra_rechazar_{tx_id}"}
            ]
        ]
    } if tx_id else None

    send_telegram_message(TELEGRAM_ADMIN_CHAT_ID, mensaje, reply_markup=keyboard)
    return jsonify({"status": "success"}), 200

@app.route("/api/procesar-compra-admin", methods=["POST"])
def procesar_compra_admin():
    data = request.get_json(silent=True) or {}
    tx_id = data.get("tx_id")
    accion = data.get("accion")
    
    if tx_id is None or not accion:
        return jsonify({"status": "error", "message": "Datos incompletos"}), 400

    if supabase_client:
        try:
            tx_res = supabase_client.table("transacciones").select("*").eq("id", tx_id).execute()
            if not tx_res.data:
                return jsonify({"status": "error", "message": "No encontrada"}), 404
            
            tx = tx_res.data[0]
            nuevo_estado = "aprobado" if accion == "aprobar" else "rechazado"
            supabase_client.table("transacciones").update({"estado": nuevo_estado}).eq("id", tx_id).execute()

            if accion == "aprobar":
                usr_res = supabase_client.table("usuarios").select("*").eq("id", tx["usuario_id"]).execute()
                if usr_res.data:
                    usr = usr_res.data[0]
                    barajitas_a_sumar = int(tx.get("barajitas_qty") or 0)
                    monto_bs_total = float(tx.get("monto_bs") or tx.get("monto") or 0.0)
                    
                    supabase_client.table("usuarios").update({
                        "cantidad_barajitas": (usr.get("cantidad_barajitas") or 0) + barajitas_a_sumar,
                        "saldo_bs": (usr.get("saldo_bs") or 0.0) + (monto_bs_total * 0.70)
                    }).eq("id", tx["usuario_id"]).execute()

            return jsonify({"status": "success"}), 200
        except Exception as e:
            return jsonify({"status": "error", "message": str(e)}), 500
    return jsonify({"status": "error", "message": "Sin conexión"}), 500

@app.route("/api/notificar-retiro", methods=["POST"])
def notificar_retiro():
    data = request.get_json(silent=True) or {}
    usuario_id = data.get("usuario_id")
    tipo = data.get("tipo", "hito_parcial")
    milestone = int(data.get("milestone", 0))
    monto_bs = data.get("monto_bs")
    monto_usd = data.get("monto_usd", 200.0)
    datos_pago = data.get("datos_pago")

    if not all([usuario_id, monto_bs, datos_pago]):
        return jsonify({"status": "error", "message": "Campos incompletos"}), 400

    w_id = None
    if supabase_client:
        try:
            res_insert = supabase_client.table("retiros").insert({
                "usuario_id": str(usuario_id),
                "tipo": str(tipo),
                "milestone": milestone,
                "monto_bs": float(monto_bs),
                "monto_usd": float(monto_usd),
                "datos_pago": str(datos_pago),
                "estado": "pendiente"
            }).execute()
            if res_insert.data:
                w_id = res_insert.data[0].get("id")
        except Exception as e:
            return jsonify({"status": "error", "message": str(e)}), 500

    mensaje = f"🚨 <b>SOLICITUD DE RETIRO / HITO</b> [ID:{w_id}]\n👤 <b>Usuario:</b> <code>{usuario_id}</code>\n💰 <b>Monto Bs.:</b> {float(monto_bs):.2f}"
    send_telegram_message(TELEGRAM_ADMIN_CHAT_ID, mensaje)
    return jsonify({"status": "success"}), 200

@app.route("/api/procesar-retiro-admin", methods=["POST"])
def procesar_retiro_admin():
    data = request.get_json(silent=True) or {}
    w_id = data.get("w_id")
    accion = data.get("accion")
    referencia = str(data.get("referencia", "")).strip()

    if w_id is None or not accion:
        return jsonify({"status": "error", "message": "Datos incompletos"}), 400

    if supabase_client:
        try:
            w_res = supabase_client.table("retiros").select("*").eq("id", w_id).execute()
            if not w_res.data:
                return jsonify({"status": "error", "message": "No encontrado"}), 404
            
            w = w_res.data[0]
            nuevo_estado = "aprobado" if accion == "aprobar" else "rechazado"
            supabase_client.table("retiros").update({"estado": nuevo_estado, "referencia": referencia}).eq("id", w_id).execute()

            if accion == "aprobar":
                usr_res = supabase_client.table("usuarios").select("*").eq("id", w["usuario_id"]).execute()
                if usr_res.data:
                    usr = usr_res.data[0]
                    if w["tipo"] == "liquidacion_total" or w.get("milestone", 0) >= 2000:
                        supabase_client.table("usuarios").update({"cantidad_barajitas": 0, "saldo_bs": 0.0}).eq("id", w["usuario_id"]).execute()
                    else:
                        nuevo_saldo = max(0.0, (usr.get("saldo_bs") or 0.0) - float(w["monto_bs"]))
                        supabase_client.table("usuarios").update({"saldo_bs": nuevo_saldo}).eq("id", w["usuario_id"]).execute()

            return jsonify({"status": "success"}), 200
        except Exception as e:
            return jsonify({"status": "error", "message": str(e)}), 500
    return jsonify({"status": "error", "message": "Sin conexión"}), 500

@app.route("/api/telegram-webhook", methods=["POST"])
def telegram_webhook():
    data = request.get_json(silent=True) or {}
    callback_query = data.get("callback_query")
    if not callback_query:
        return jsonify({"status": "ok"}), 200

    query_id = callback_query.get("id")
    data_str = callback_query.get("data", "")
    message_cb = callback_query.get("message", {})
    chat_id = message_cb.get("chat", {}).get("id")
    message_id = message_cb.get("message_id")

    parts = data_str.split("_")
    if len(parts) >= 2 and supabase_client:
        try:
            tipo_accion = parts[0]
            if tipo_accion == "desbloquear":
                target_user_id = parts[1]
                supabase_client.table("usuarios").update({"bloqueado": False, "intentos_admin": 0}).eq("id", target_user_id).execute()
                
                requests.post(f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/answerCallbackQuery", json={"callback_query_id": query_id, "text": f"¡Usuario {target_user_id} desbloqueado!"}, timeout=5)
                return jsonify({"status": "ok"}), 200
        except Exception as e:
            print(f"Error webhook: {e}")

    return jsonify({"status": "ok"}), 200

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
