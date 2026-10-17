import os
import threading
import requests
import traceback
import re
from flask import Flask, request, jsonify
from flask_cors import CORS
from supabase import create_client, Client
from datetime import datetime, timedelta, timezone

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").strip()
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip() or os.environ.get("SUPABASE_KEY", "").strip()
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
TELEGRAM_ADMIN_CHAT_ID = os.environ.get("TELEGRAM_ADMIN_CHAT_ID", "").strip()
ADMIN_USER_ID = os.environ.get("ADMIN_USER_ID", "").strip()

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
    return jsonify({"status": "online", "service": "Álbum Digital Backend", "version": "3.5.0"}), 200

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
        existing_user = supabase_client.table("usuarios").select("id").eq("id", user_id).execute()
        if existing_user.data and len(existing_user.data) > 0:
            return jsonify({"error": "El nombre de usuario ya está registrado. Por favor elige otro."}), 400

        supabase_client.table("usuarios").insert([{
            "id": user_id,
            "username": username,
            "password_hash": password,
            "gmail": email,
            "banco": banco,
            "cedula": cedula,
            "telefono": telefono,
            "cantidad_barajitas": 0,
            "saldo_bs": 0.0,
            "terminos_aceptados": True,
            "privacidad_aceptada": True,
            "fecha_aceptacion": datetime.now(timezone.utc).isoformat(),
            "bloqueado": False
        }]).execute()
        
        return jsonify({"success": True}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@app.route("/api/solicitar-recuperacion", methods=["POST"])
def solicitar_recuperacion():
    data = request.get_json(silent=True) or {}
    username = str(data.get("username", "")).strip()
    email = str(data.get("email", "")).strip()
    cedula = str(data.get("cedula", "")).strip()
    telefono = str(data.get("telefono", "")).strip()

    if not all([username, email, cedula, telefono]):
        return jsonify({"success": False, "message": "Faltan datos obligatorios."}), 400

    if not supabase_client:
        return jsonify({"success": False, "message": "Error de base de datos."}), 400

    try:
        res = supabase_client.table("usuarios").select("*").eq("username", username).execute()
        user = res.data[0] if res.data and len(res.data) > 0 else None

        if not user:
            return jsonify({"success": False, "message": "El nombre de usuario no existe en el sistema."}), 404

        mensaje_admin = (
            f"🔑 <b>¡SOLICITUD DE RECUPERACIÓN DE CONTRASEÑA!</b>\n\n"
            f"👤 <b>Usuario:</b> <code>{username}</code>\n"
            f"📧 <b>Correo:</b> <code>{email}</code>\n"
            f"🆔 <b>Cédula:</b> <code>{cedula}</code>\n"
            f"📱 <b>Teléfono:</b> <code>{telefono}</code>\n\n"
            f"<i>⚠️ Valida estos datos llamando o escribiendo al usuario antes de entregar su contraseña.</i>"
        )
        
        keyboard = {
            "inline_keyboard": [
                [{"text": "📞 Contactar por WhatsApp", "url": f"https://wa.me/58{telefono.replace('0', '', 1)}"}]
            ]
        }

        send_telegram_message(TELEGRAM_ADMIN_CHAT_ID, mensaje_admin, reply_markup=keyboard)
        return jsonify({"success": True, "message": "Solicitud enviada al administrador."}), 200

    except Exception as e:
        print(f"Error en solicitar_recuperacion: {e}")
        return jsonify({"success": False, "message": str(e)}), 500

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
        transacciones_res = supabase_client.table("transacciones").select("*").eq("usuario_id", usuario_id).execute()
        
        return jsonify({
            "user": user_data,
            "retiros": retiros_res.data or [],
            "transacciones": transacciones_res.data or []
        }), 200
    except Exception as e:
        print("❌ Error detallado en /api/usuario/info:")
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

# 💓 Endpoint de Latido (Heartbeat) para Presencia en Tiempo Real
@app.route("/api/heartbeat", methods=["POST"])
def api_heartbeat():
    data = request.get_json(silent=True) or {}
    usuario_id = str(data.get("usuario_id", "")).strip()
    if not usuario_id or not supabase_client:
        return jsonify({"success": False}), 400
    try:
        supabase_client.table("usuarios").update({
            "ultimo_latido": datetime.now(timezone.utc).isoformat()
        }).eq("id", usuario_id).execute()
        return jsonify({"success": True}), 200
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/notificar-login", methods=["POST"])
def notificar_login():
    data = request.get_json(silent=True) or {}
    usuario_id = str(data.get("usuario_id", "")).strip()
    
    if not usuario_id:
        return jsonify({"status": "error", "message": "ID no proporcionado"}), 400

    if usuario_id.upper() == ADMIN_USER_ID.upper():
        mensaje = (
            f"🔐 <b>¡ACCESO DE ADMINISTRADOR DETECTADO!</b>\n\n"
            f"👤 <b>Administrador:</b> <code>{usuario_id}</code>\n"
            f"🌐 Se ha iniciado sesión correctamente en el Panel de Administración.\n\n"
            f"<i>¿No fuiste tú? Bloquea el acceso o protege los datos de pago abajo.</i>"
        )
        keyboard_admin = {
            "inline_keyboard": [
                [
                    {"text": "🚨 Bloquear / Expulsar", "callback_data": f"bloquear_{usuario_id}"},
                    {"text": "🔓 Desbloquear", "callback_data": f"desbloquear_{usuario_id}"}
                ],
                [
                    {"text": "🔒 Bloquear Pago", "callback_data": "bloquear_pago"},
                    {"text": "🔓 Desbloquear Pago", "callback_data": "desbloquear_pago"}
                ],
                [
                    {"text": "🌐 Entrar al Panel Admin", "url": "https://will930u.github.io/ALBUM_DIGITAL_1/admin.html"}
                ]
            ]
        }
        send_telegram_message(TELEGRAM_ADMIN_CHAT_ID, mensaje, reply_markup=keyboard_admin)
    else:
        mensaje = (
            f"👤 <b>Nuevo Inicio de Sesión</b>\n\n"
            f"ID de Usuario: <code>{usuario_id}</code>"
        )
        send_telegram_message(TELEGRAM_ADMIN_CHAT_ID, mensaje)

    return jsonify({"status": "success"}), 200

@app.route("/api/notificar-logout", methods=["POST"])
def notificar_logout():
    data = request.get_json(silent=True) or {}
    usuario_id = str(data.get("usuario_id", "")).strip()
    
    if not usuario_id:
        return jsonify({"status": "error", "message": "ID no proporcionado"}), 400

    mensaje = (
        f"🔴 <b>CIERRE DE SESIÓN</b>\n\n"
        f"👤 <b>Usuario:</b> <code>{usuario_id}</code>\n"
        f"🚪 Ha cerrado sesión correctamente de la plataforma."
    )
    send_telegram_message(TELEGRAM_ADMIN_CHAT_ID, mensaje)
    return jsonify({"status": "success"}), 200

# ==========================================
# ENDPOINTS DEL PANEL ADMINISTRADOR
# ==========================================

@app.route("/api/verificar-admin", methods=["POST"])
def verificar_admin():
    data = request.get_json(silent=True) or {}
    usuario_id = str(data.get("usuario_id", "")).strip()

    if supabase_client:
        try:
            usr_res = supabase_client.table("usuarios").select("*").eq("id", usuario_id).execute()
            if usr_res.data and len(usr_res.data) > 0:
                usr = usr_res.data[0]
                if usr.get("bloqueado") is True:
                    return jsonify({"status": "blocked", "bloqueado": True, "message": "Acceso revocado por el administrador."}), 403
        except Exception as e:
            print(f"Error consultando estado de bloqueo: {e}")

    if usuario_id.upper() == ADMIN_USER_ID.upper():
        return jsonify({"status": "authorized"}), 200

    if supabase_client:
        try:
            usr_res = supabase_client.table("usuarios").select("*").eq("id", usuario_id).execute()
            if usr_res.data and len(usr_res.data) > 0:
                usr = usr_res.data[0]
                if usr.get("bloqueado", False):
                    return jsonify({"status": "blocked", "message": "Tu cuenta ha sido bloqueada."}), 403

                intentos_actuales = (usr.get("intentos_admin") or 0) + 1
                
                if intentos_actuales >= 3:
                    supabase_client.table("usuarios").update({
                        "intentos_admin": intentos_actuales,
                        "bloqueado": True
                    }).eq("id", usuario_id).execute()
                    return jsonify({"status": "blocked", "message": "Cuenta bloqueada por reincidencia."}), 403
                else:
                    supabase_client.table("usuarios").update({
                        "intentos_admin": intentos_actuales
                    }).eq("id", usuario_id).execute()
                    return jsonify({"status": "warning", "intentos": intentos_actuales}), 200
        except Exception as e:
            print(f"Error en verificación admin: {e}")

    return jsonify({"status": "unauthorized"}), 403

@app.route("/api/admin/toggle-bloqueo", methods=["POST"])
def admin_toggle_bloqueo():
    data = request.get_json(silent=True) or {}
    usuario_id = str(data.get("usuario_id", "")).strip()
    bloquear = data.get("bloquear", False)

    if not supabase_client or not usuario_id:
        return jsonify({"error": "Datos incompletos"}), 400

    try:
        supabase_client.table("usuarios").update({
            "bloqueado": bool(bloquear)
        }).eq("id", usuario_id).execute()
        return jsonify({"success": True}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/admin/configuracion", methods=["GET", "POST"])
def admin_configuracion():
    if not supabase_client:
        return jsonify({"error": "BD no disponible"}), 500

    if request.method == "GET":
        try:
            res = supabase_client.table("configuracion").select("*").limit(1).execute()
            config_data = res.data[0] if res.data and len(res.data) > 0 else {"pago_bloqueado": True}
            return jsonify(config_data), 200
        except Exception as e:
            return jsonify({"error": str(e)}), 500
    
    elif request.method == "POST":
        data = request.get_json(silent=True) or {}
        try:
            # 🔒 Validar si la configuración de pago está bloqueada por seguridad desde Telegram
            res_chk = supabase_client.table("configuracion").select("pago_bloqueado").limit(1).execute()
            if res_chk.data and res_chk.data[0].get("pago_bloqueado") is True:
                return jsonify({"error": "La configuración de pago se encuentra bloqueada por seguridad desde Telegram."}), 403

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
        return jsonify({"total_sales": 0, "bcv_rate": 1.0, "approved_count": 0, "stickers_sold": 0, "total_usuarios": 0, "usuarios_online": 0}), 200
    try:
        res = supabase_client.table("transacciones").select("*").eq("estado", "aprobado").execute()
        transacciones = res.data or []
        
        total_sales = sum([float(t.get("monto_bs") or t.get("monto") or 0) for t in transacciones])
        approved_count = len(transacciones)
        stickers_sold = sum([int(t.get("barajitas_qty") or 0) for t in transacciones])
        
        usr_res = supabase_client.table("usuarios").select("id, ultimo_latido").execute()
        usuarios = usr_res.data or []
        total_usuarios = len(usuarios)
        
        ahora = datetime.now(timezone.utc)
        usuarios_online = 0
        for u in usuarios:
            latido = u.get("ultimo_latido")
            if latido:
                try:
                    latido_str = latido.replace('Z', '+00:00')
                    dt_latido = datetime.fromisoformat(latido_str)
                    if dt_latido.tzinfo is None:
                        dt_latido = dt_latido.replace(tzinfo=timezone.utc)
                        
                    if (ahora - dt_latido) <= timedelta(seconds=90):
                        usuarios_online += 1
                except Exception as e:
                    print(f"Error procesando latido para usuario {u.get('id')}: {e}")

        bcv_rate = 1.0
        try:
            r_bcv = requests.get("https://ve.dolarapi.com/v1/dolares/oficial", timeout=3)
            if r_bcv.ok:
                bcv_data = r_bcv.json()
                bcv_rate = float(bcv_data.get("promedio", 1.0))
        except:
            pass

        return jsonify({
            "total_sales": total_sales,
            "bcv_rate": bcv_rate,
            "approved_count": approved_count,
            "stickers_sold": stickers_sold,
            "total_usuarios": total_usuarios,
            "usuarios_online": usuarios_online
        }), 200
    except Exception as e:
        print(f"Error en admin_metricas: {e}")
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
            existing = supabase_client.table("transacciones").select("id").eq("referencia", referencia).execute()
            if existing.data and len(existing.data) > 0:
                return jsonify({"status": "error", "message": "La referencia ya fue reportada."}), 400

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
        f"📱 <b>Teléfono:</b> <code>{telefono or 'N/A'}</code>\n"
        f"🏦 <b>Banco:</b> <code>{banco or 'N/A'}</code>\n"
        f"🔢 <b>Referencia:</b> <code>{referencia}</code>\n"
        f"📅 <b>Fecha:</b> {fecha_pago or 'N/A'}"
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
    return jsonify({"status": "success", "telegram_sent": True}), 200

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
            if not tx_res.data or len(tx_res.data) == 0:
                return jsonify({"status": "error", "message": "Transacción no encontrada"}), 404
            
            tx = tx_res.data[0]
            nuevo_estado = "aprobado" if accion == "aprobar" else "rechazado"
            supabase_client.table("transacciones").update({"estado": nuevo_estado}).eq("id", tx_id).execute()

            if accion == "aprobar":
                usr_res = supabase_client.table("usuarios").select("*").eq("id", tx["usuario_id"]).execute()
                if usr_res.data and len(usr_res.data) > 0:
                    usr = usr_res.data[0]
                    barajitas_a_sumar = int(tx.get("barajitas_qty") or 0)
                    monto_bs_total = float(tx.get("monto_bs") or tx.get("monto") or 0.0)
                    
                    nueva_cantidad = (usr.get("cantidad_barajitas") or 0) + barajitas_a_sumar
                    nuevo_saldo = (usr.get("saldo_bs") or 0.0) + (monto_bs_total * 0.70)
                    
                    supabase_client.table("usuarios").update({
                        "cantidad_barajitas": nueva_cantidad,
                        "saldo_bs": nuevo_saldo
                    }).eq("id", tx["usuario_id"]).execute()

            return jsonify({"status": "success"}), 200
        except Exception as e:
            return jsonify({"status": "error", "message": str(e)}), 500
    return jsonify({"status": "error", "message": "Sin conexión a BD"}), 500

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
            if res_insert.data and len(res_insert.data) > 0:
                w_id = res_insert.data[0].get("id")
        except Exception as e:
            return jsonify({"status": "error", "message": str(e)}), 500

    mensaje = f"🏆 <b>SOLICITUD DE RETIRO / HITO (#{milestone})</b> [ID:{w_id}]\n\n👤 <b>Usuario:</b> <code>{usuario_id}</code>\n💰 <b>Monto Bs.:</b> {float(monto_bs):.2f}\n📱 <b>Pago Móvil:</b> {datos_pago}"
    send_telegram_message(TELEGRAM_ADMIN_CHAT_ID, mensaje)
    return jsonify({"status": "success", "telegram_sent": True}), 200
    
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
                return jsonify({"status": "error", "message": "Retiro no encontrado"}), 404
            
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

# ==========================================
# WEBHOOK DE TELEGRAM CORREGIDO (CON CERROJO DE PAGO)
# ==========================================

@app.route("/api/telegram-webhook", methods=["POST"])
def telegram_webhook():
    data = request.get_json(silent=True) or {}
    
    # 1. Manejo de respuestas de texto (por ejemplo, al responder con número de referencia)
    message = data.get("message")
    if message and message.get("text"):
        reply_to = message.get("reply_to_message")
        if reply_to and reply_to.get("text"):
            text_original = reply_to.get("text")
            match = re.search(r'\[ID:(\d+)\]', text_original)
            if match:
                w_id = int(match.group(1))
                referencia_ingresada = message.get("text").strip()
                chat_id = message.get("chat", {}).get("id")

                if supabase_client:
                    try:
                        w_res = supabase_client.table("retiros").select("*").eq("id", w_id).execute()
                        if w_res.data:
                            w = w_res.data[0]
                            tipo_retiro = w.get("tipo", "")
                            milestone_val = int(w.get("milestone") or 0)

                            supabase_client.table("retiros").update({
                                "estado": "aprobado",
                                "referencia": referencia_ingresada
                            }).eq("id", w_id).execute()

                            if tipo_retiro == "liquidacion_total" or milestone_val >= 2000 or tipo_retiro == "ciclo_completo":
                                supabase_client.table("usuarios").update({
                                    "cantidad_barajitas": 0,
                                    "saldo_bs": 0.0
                                }).eq("id", w["usuario_id"]).execute()
                            else:
                                usr_res = supabase_client.table("usuarios").select("*").eq("id", w["usuario_id"]).execute()
                                if usr_res.data:
                                    usr = usr_res.data[0]
                                    nuevo_saldo = max(0.0, (usr.get("saldo_bs") or 0.0) - float(w["monto_bs"]))
                                    supabase_client.table("usuarios").update({
                                        "saldo_bs": nuevo_saldo
                                    }).eq("id", w["usuario_id"]).execute()

                            send_telegram_message(chat_id, f"✅ <b>PAGO REGISTRADO Y RETIRO APROBADO</b>\nReferencia: <code>{referencia_ingresada}</code>")
                            return jsonify({"status": "ok"}), 200
                    except Exception as e:
                        print(f"Error procesando texto en webhook: {e}")

    # 2. Manejo de botones de acción (Callback Queries)
    callback_query = data.get("callback_query")
    if not callback_query:
        return jsonify({"status": "ok"}), 200

    query_id = callback_query.get("id")
    data_str = callback_query.get("data", "")
    message_cb = callback_query.get("message", {})
    chat_id = message_cb.get("chat", {}).get("id")
    message_id = message_cb.get("message_id")
    texto_original = message_cb.get("text", "Solicitud")

    # ⚡ RESPUESTA INMEDIATA OBLIGATORIA A TELEGRAM PARA EVITAR EL TIMEOUT (CODE #400)
    try:
        requests.post(f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/answerCallbackQuery", json={
            "callback_query_id": query_id,
            "text": "⚡ Procesando solicitud..."
        }, timeout=5)
    except Exception as e:
        print(f"Error al enviar answerCallbackQuery inicial: {e}")

    # 🔒 Acciones directas de cerrojo de pago
    if supabase_client:
        try:
            # Definición del teclado que DEBE PERMANECER SIEMPRE VISIBLE
            keyboard_admin = {
                "inline_keyboard": [
                    [
                        {"text": "🚨 Bloquear / Expulsar", "callback_data": f"bloquear_{ADMIN_USER_ID}"},
                        {"text": "🔓 Desbloquear", "callback_data": f"desbloquear_{ADMIN_USER_ID}"}
                    ],
                    [
                        {"text": "🔒 Bloquear Pago", "callback_data": "bloquear_pago"},
                        {"text": "🔓 Desbloquear Pago", "callback_data": "desbloquear_pago"}
                    ],
                    [
                        {"text": "🌐 Entrar al Panel Admin", "url": "https://will930u.github.io/ALBUM_DIGITAL_1/admin.html"}
                    ]
                ]
            }

            if data_str == "bloquear_pago":
                supabase_client.table("configuracion").update({"pago_bloqueado": True}).eq("id", 1).execute()
                requests.post(f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/editMessageText", json={
                    "chat_id": chat_id,
                    "message_id": message_id,
                    "text": f"{texto_original.split('ESTADO:')[0].strip()}\n\n<b>ESTADO: 🔒 CONFIGURACIÓN DE PAGO BLOQUEADA</b>",
                    "parse_mode": "HTML",
                    "reply_markup": keyboard_admin # 👈 Mantener la botonera visible
                }, timeout=5)
                return jsonify({"status": "ok"}), 200

            if data_str == "desbloquear_pago":
                supabase_client.table("configuracion").update({"pago_bloqueado": False}).eq("id", 1).execute()
                requests.post(f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/editMessageText", json={
                    "chat_id": chat_id,
                    "message_id": message_id,
                    "text": f"{texto_original.split('ESTADO:')[0].strip()}\n\n<b>ESTADO: 🔓 CONFIGURACIÓN DE PAGO DESBLOQUEADA</b>",
                    "parse_mode": "HTML",
                    "reply_markup": keyboard_admin # 👈 Mantener la botonera visible
                }, timeout=5)
                return jsonify({"status": "ok"}), 200

        except Exception as e:
            print(f"Error en acciones de pago: {e}")

    parts = data_str.split("_")
    if len(parts) >= 2:
        tipo_accion = parts[0]

        if supabase_client:
            try:
                # 🔓 Caso Desbloqueo de Usuario
                if tipo_accion == "desbloquear":
                    target_user_id = parts[1] if len(parts) > 1 else ""
                    if target_user_id:
                        supabase_client.table("usuarios").update({
                            "bloqueado": False,
                            "intentos_admin": 0
                        }).eq("id", target_user_id).execute()

                    requests.post(f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/editMessageText", json={
                        "chat_id": chat_id,
                        "message_id": message_id,
                        "text": f"{texto_original}\n\n<b>ESTADO: 🔓 USUARIO DESBLOQUEADO</b>",
                        "parse_mode": "HTML"
                    }, timeout=5)
                    return jsonify({"status": "ok"}), 200

                # 🔒 Caso Bloqueo de Usuario
                if tipo_accion == "bloquear":
                    target_user_id = parts[1] if len(parts) > 1 else ""
                    if target_user_id:
                        supabase_client.table("usuarios").update({
                            "bloqueado": True
                        }).eq("id", target_user_id).execute()

                    requests.post(f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/editMessageText", json={
                        "chat_id": chat_id,
                        "message_id": message_id,
                        "text": f"{texto_original}\n\n<b>ESTADO: 🚨 USUARIO BLOQUEADO Y EXPULSADO</b>",
                        "parse_mode": "HTML"
                    }, timeout=5)
                    return jsonify({"status": "ok"}), 200

                # 🛒 Caso Compras y Retiros (Ej: compra_aprobar_12 o compra_rechazar_12)
                if len(parts) >= 3:
                    accion = parts[1]
                    item_id = parts[2]

                    if tipo_accion == "compra":
                        tx_res = supabase_client.table("transacciones").select("*").eq("id", item_id).execute()
                        if tx_res.data:
                            tx = tx_res.data[0]
                            nuevo_estado = "aprobado" if accion == "aprobar" else "rechazado"
                            supabase_client.table("transacciones").update({"estado": nuevo_estado}).eq("id", item_id).execute()

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

                    elif tipo_accion == "retiro":
                        w_res = supabase_client.table("retiros").select("*").eq("id", item_id).execute()
                        if w_res.data:
                            w = w_res.data[0]
                            nuevo_estado = "aprobado" if accion == "aprobar" else "rechazado"
                            supabase_client.table("retiros").update({"estado": nuevo_estado}).eq("id", item_id).execute()

                            if accion == "aprobar":
                                usr_res = supabase_client.table("usuarios").select("*").eq("id", w["usuario_id"]).execute()
                                if usr_res.data:
                                    usr = usr_res.data[0]
                                    if w["tipo"] == "liquidacion_total" or w.get("milestone", 0) >= 2000:
                                        supabase_client.table("usuarios").update({"cantidad_barajitas": 0, "saldo_bs": 0.0}).eq("id", w["usuario_id"]).execute()
                                    else:
                                        nuevo_saldo = max(0.0, (usr.get("saldo_bs") or 0.0) - float(w["monto_bs"]))
                                        supabase_client.table("usuarios").update({"saldo_bs": nuevo_saldo}).eq("id", w["usuario_id"]).execute()

                    # Actualización visual del mensaje en el chat de Telegram
                    estado_texto = "✅ APROBADO Y APLICADO" if accion == "aprobar" else "❌ RECHAZADO"
                    nuevo_texto_tg = f"{texto_original}\n\n<b>ESTADO: {estado_texto}</b>"

                    requests.post(f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/editMessageText", json={
                        "chat_id": chat_id,
                        "message_id": message_id,
                        "text": nuevo_texto_tg,
                        "parse_mode": "HTML"
                    }, timeout=10)

            except Exception as e:
                print(f"Error procesando callback: {e}")
                traceback.print_exc()

    return jsonify({"status": "ok"}), 200

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
