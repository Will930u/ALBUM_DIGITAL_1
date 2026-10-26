import os
import threading
import requests
import traceback
import re
import secrets
from flask import Flask, request, jsonify
from flask_cors import CORS
from supabase import create_client, Client
from datetime import datetime, timedelta, timezone
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

# 1️⃣ Primero se crea la aplicación Flask
app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

# 🛡️ MANEJADOR GLOBAL PARA PREFLIGHT REQUESTS (CORS + OPTIONS)
@app.before_request
def handle_preflight():
    if request.method == "OPTIONS":
        response = jsonify({"status": "ok"})
        response.headers.add("Access-Control-Allow-Origin", "*")
        response.headers.add("Access-Control-Allow-Headers", "Content-Type, Authorization")
        response.headers.add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        return response, 200

# 2️⃣ Después se inicializa el limitador usando la aplicación ya creada
limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["500 per day", "200 per hour"],
    storage_uri="memory://"
)

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

# 🎛️ FUNCIÓN PARA VERIFICAR SI EL SISTEMA ESTÁ ACTIVO
def verificar_sistema_activo():
    if not supabase_client:
        return True
    try:
        res = supabase_client.table("system_config").select("value").eq("key", "is_online").execute()
        if res.data and len(res.data) > 0:
            return res.data[0].get("value", True)
    except Exception as e:
        print(f"Error verificando estado del sistema: {e}")
    return True

def obtener_datos_cliente(req):
    ip = req.headers.get("X-Forwarded-For", req.remote_addr)
    if ip and "," in ip:
        ip = ip.split(",")[0].strip()
    user_agent = req.headers.get("User-Agent", "Desconocido")
    return ip, user_agent

def registrar_conexion(usuario_id, evento_tipo):
    if not supabase_client:
        return
    try:
        client_ip, user_agent = obtener_datos_cliente(request)
        supabase_client.table("conexiones").insert([{
            "usuario_id": str(usuario_id) if usuario_id else "ANÓNIMO",
            "ip_address": client_ip,
            "dispositivo_info": user_agent,
            "evento": evento_tipo,
            "created_at": datetime.now(timezone.utc).isoformat()
        }]).execute()
    except Exception as e:
        print(f"Error al registrar conexión en BD: {e}")

def validar_token_sesion(usuario_id, token_enviado):
    if not usuario_id or not token_enviado or not supabase_client:
        return False
    try:
        res = supabase_client.table("usuarios").select("session_token, bloqueado").eq("id", usuario_id).execute()
        if res.data and len(res.data) > 0:
            usr = res.data[0]
            if usr.get("bloqueado") is True:
                return False
            return usr.get("session_token") == token_enviado
    except Exception as e:
        print(f"Error al validar token de sesión: {e}")
    return False

def verificar_y_sumar_referido(usuario_comprador_id):
    if not supabase_client:
        return
    try:
        res_comprador = supabase_client.table("usuarios").select("referido_por, primera_compra_referido_hecha, cantidad_barajitas").eq("id", usuario_comprador_id).execute()
        if not res_comprador.data:
            return
            
        comprador = res_comprador.data[0]
        padrino_id = comprador.get("referido_por")
        ya_conto = comprador.get("primera_compra_referido_hecha", False)
        cantidad_barajitas = int(comprador.get("cantidad_barajitas", 0) or 0)
        
        if padrino_id and not ya_conto and cantidad_barajitas >= 5:
            supabase_client.table("usuarios").update({"primera_compra_referido_hecha": True}).eq("id", usuario_comprador_id).execute()
            
            res_padrino = supabase_client.table("usuarios").select("*").eq("id", padrino_id).execute()
            if res_padrino.data:
                padrino = res_padrino.data[0]
                mes_actual = datetime.now(timezone.utc).month
                
                referidos_mes = padrino.get("referidos_activos_mes", 0) or 0
                bonos_mes = padrino.get("bonos_referidos_mes", 0) or 0
                
                if padrino.get("ultimo_mes_bono") != mes_actual:
                    referidos_mes = 0
                    bonos_mes = 0
                    
                nuevos_referidos = referidos_mes + 1
                
                if nuevos_referidos >= 10 and bonos_mes < 1:
                    saldo_actual_bs = float(padrino.get("saldo_bs") or 0.0)
                    nuevo_saldo_bs = saldo_actual_bs + 180.0
                    
                    supabase_client.table("usuarios").update({
                        "saldo_bs": nuevo_saldo_bs,
                        "referidos_activos_mes": 0,
                        "bonos_referidos_mes": bonos_mes + 1,
                        "ultimo_mes_bono": mes_actual
                    }).eq("id", padrino_id).execute()
                else:
                    supabase_client.table("usuarios").update({
                        "referidos_activos_mes": nuevos_referidos,
                        "ultimo_mes_bono": mes_actual
                    }).eq("id", padrino_id).execute()
    except Exception as e:
        print(f"Error al procesar referido en compra: {e}")
        
   # 📊 FUNCIÓN PARA REGISTRAR TASA DIARIA EN SUPABASE
def registrar_tasa_diaria(tasa_actual):
    if not supabase_client:
        return
    try:
        hoy = datetime.now().strftime('%Y-%m-%d')
        res = supabase_client.table("historial_tasas").select("id").eq("fecha", hoy).execute()
        if not res.data:
            supabase_client.table("historial_tasas").insert({
                "fecha": hoy,
                "tasa_bcv": float(tasa_actual)
            }).execute()
            print(f"[HISTORIAL] Tasa guardada para la fecha {hoy}: {tasa_actual} Bs.")
    except Exception as e:
        print(f"[HISTORIAL ERROR] No se pudo guardar la tasa diaria: {e}")

@app.route("/", methods=["GET"])
def index():
    is_active = verificar_sistema_activo()
    return jsonify({
        "status": "online" if is_active else "maintenance", 
        "service": "Álbum Digital Backend", 
        "version": "4.1.1-secure",
        "is_online": is_active
    }), 200
    
@app.route("/api/system-status", methods=["GET"])
def api_system_status():
    is_active = verificar_sistema_activo()
    return jsonify({"is_online": is_active}), 200
    
@app.route("/api/bcv", methods=["GET"])
def get_bcv_rate():
    try:
        res = requests.get("https://ve.dolarapi.com/v1/dolares/oficial", timeout=5)
        if res.ok:
            data = res.json()
            promedio = data.get("promedio", 0)
            if promedio > 0:
                registrar_tasa_diaria(promedio) # 👈 Guarda automáticamente la tasa al consultarla
            return jsonify({"status": "success", "promedio": promedio}), 200
        return jsonify({"status": "error", "message": "No se pudo obtener la tasa BCV"}), 502
    except Exception as e:
        return jsonify({"status": "error", "details": str(e)}), 500

@app.route("/api/feed-actividad", methods=["GET"])
def api_feed_actividad():
    if not supabase_client:
        return jsonify({"status": "error", "message": "BD no disponible"}), 500
    try:
        tx_res = supabase_client.table("transacciones") \
            .select("id, usuario_id, barajitas_qty, monto_bs, created_at, fecha_aprobacion") \
            .eq("estado", "aprobado") \
            .order("fecha_aprobacion", desc=True) \
            .limit(40) \
            .execute()
        
        retiros_res = supabase_client.table("retiros") \
            .select("id, usuario_id, tipo, milestone, monto_bs, created_at, referencia") \
            .eq("estado", "aprobado") \
            .order("created_at", desc=True) \
            .limit(40) \
            .execute()

        actividades_raw = []
        
        for t in (tx_res.data or []):
            actividades_raw.append({
                "tipo": "compra",
                "usuario_id": t.get("usuario_id"),
                "detalle": f"compró {t.get('barajitas_qty')} barajitas",
                "monto_bs": t.get("monto_bs"),
                "fecha": t.get("fecha_aprobacion") or t.get("created_at")
            })

        for r in (retiros_res.data or []):
            tipo_retiro = r.get("tipo")
            milestone = r.get("milestone") or 0
            texto_detalle = "realizó liquidación total" if tipo_retiro == "liquidacion_total" or milestone >= 1000 else f"reclamó Premio Hito #{milestone}"
            
            actividades_raw.append({
                "tipo": "retiro",
                "usuario_id": r.get("usuario_id"),
                "detalle": texto_detalle,
                "monto_bs": r.get("monto_bs"),
                "fecha": r.get("created_at")
            })

        actividades_raw.sort(key=lambda x: x["fecha"] or "", reverse=True)

        usuarios_vistos = set()
        actividades_filtradas = []
        
        for act in actividades_raw:
            raw_uid = act.get("usuario_id")
            if raw_uid:
                uid_normalizado = str(raw_uid).strip().upper()
                if uid_normalizado not in usuarios_vistos:
                    usuarios_vistos.add(uid_normalizado)
                    actividades_filtradas.append(act)

        return jsonify({"status": "success", "actividades": actividades_filtradas[:15]}), 200
    except Exception as e:
        print(f"Error en /api/feed-actividad: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500
        
        @app.route("/api/login", methods=["POST"])
        @limiter.limit("5 per minute")
        def api_login():
            if not verificar_sistema_activo():
                 return jsonify({"success": False, "message": "La plataforma se encuentra en mantenimiento temporalmente."}), 403
                
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

        session_token = secrets.token_hex(32)
        
        supabase_client.table("usuarios").update({
            "session_token": session_token
        }).eq("id", user.get("id")).execute()

        registrar_conexion(user.get("id"), "login")

        return jsonify({
            "success": True, 
            "user_id": user.get("id"),
            "session_token": session_token
        }), 200
    except Exception as e:
        print(f"Error en login: {e}")
        return jsonify({"success": False, "message": str(e)}), 500

@app.route("/api/register", methods=["POST"])
def api_register():
    if not verificar_sistema_activo():
        return jsonify({"error": "La plataforma se encuentra apagada temporalmente."}), 403

    data = request.get_json(silent=True) or {}
    username = str(data.get("username", "")).strip()
    email = str(data.get("email", "")).strip()
    password = str(data.get("password", "")).strip()
    banco = str(data.get("banco", "")).strip()
    cedula = str(data.get("cedula", "")).strip()
    telefono = str(data.get("telefono", "")).strip()
    codigo_ref_recibido = str(data.get("ref", "")).strip()

    if not all([username, email, password]):
        return jsonify({"error": "Faltan campos obligatorios"}), 400

    if len(password) > 12:
        return jsonify({"error": "La contraseña no puede tener más de 12 caracteres."}), 400

    user_id = f"USR-{username.upper()}"

    if not supabase_client:
        return jsonify({"error": "Error de base de datos"}), 500

    try:
        existing_user = supabase_client.table("usuarios").select("id").eq("id", user_id).execute()
        if existing_user.data and len(existing_user.data) > 0:
            return jsonify({"error": "El nombre de usuario ya está registrado. Por favor elige otro."}), 400

        session_token = secrets.token_hex(32)
        codigo_referido_propio = f"REF-{secrets.token_hex(4).upper()}"

        padrino_id = None
        if codigo_ref_recibido:
            res_padre = supabase_client.table("usuarios").select("id").eq("codigo_referido", codigo_ref_recibido).execute()
            if res_padre.data:
                padrino_id = res_padre.data[0].get("id")

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
            "session_token": session_token,
            "codigo_referido": codigo_referido_propio,
            "referido_por": padrino_id,
            "referidos_activos_mes": 0,
            "bonos_referidos_mes": 0,
            "ultimo_mes_bono": datetime.now(timezone.utc).month,
            "primera_compra_referido_hecha": False,
            "terminos_aceptados": True,
            "privacidad_aceptada": True,
            "fecha_aceptacion": datetime.now(timezone.utc).isoformat(),
            "bloqueado": False
        }]).execute()
        
        registrar_conexion(user_id, "registro")

        return jsonify({
            "success": True,
            "user_id": user_id,
            "session_token": session_token
        }), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@app.route("/api/referidos/obtener-link", methods=["POST"])
def obtener_link_referido():
    data = request.get_json(silent=True) or {}
    user_id = str(data.get("usuario_id", "")).strip()
    session_token = str(data.get("session_token", "")).strip()
    
    if not validar_token_sesion(user_id, session_token):
        return jsonify({"success": False, "message": "Sesión inválida o expirada"}), 401
        
    try:
        res = supabase_client.table("usuarios").select("cantidad_barajitas, codigo_referido, referidos_activos_mes, bonos_referidos_mes, ultimo_mes_bono").eq("id", user_id).execute()
        if not res.data:
            return jsonify({"success": False, "message": "Usuario no encontrado"}), 404
            
        user = res.data[0]
        barajitas_compradas = int(user.get("cantidad_barajitas", 0) or 0)
        
        if barajitas_compradas < 100:
            return jsonify({
                "success": False, 
                "unlocked": False,
                "message": f"Debes comprar al menos 100 barajitas para desbloquear tu enlace de referido. (Llevas {barajitas_compradas}/100)"
            }), 200
            
        mes_actual = datetime.now(timezone.utc).month
        if user.get("ultimo_mes_bono") != mes_actual:
            supabase_client.table("usuarios").update({
                "referidos_activos_mes": 0,
                "bonos_referidos_mes": 0,
                "ultimo_mes_bono": mes_actual
            }).eq("id", user_id).execute()
            user["referidos_activos_mes"] = 0
            user["bonos_referidos_mes"] = 0

        codigo_ref = user.get("codigo_referido")
        if not codigo_ref:
            codigo_ref = f"REF-{secrets.token_hex(4).upper()}"
            supabase_client.table("usuarios").update({"codigo_referido": codigo_ref}).eq("id", user_id).execute()

        link_referido = f"https://will930u.github.io/ALBUM_DIGITAL_1/index.html?ref={codigo_ref}"
        
        return jsonify({
            "success": True,
            "unlocked": True,
            "link": link_referido,
            "referidos_mes": user.get("referidos_activos_mes", 0),
            "bonos_cobrados_mes": user.get("bonos_referidos_mes", 0)
        }), 200
    except Exception as e:
        print(f"Error en obtener_link_referido: {e}")
        return jsonify({"success": False, "message": str(e)}), 500
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
    session_token = str(data.get("session_token", "")).strip()

    if not validar_token_sesion(usuario_id, session_token):
        return jsonify({"error": "Sesión inválida o expirada"}), 401

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

@app.route("/api/heartbeat", methods=["POST"])
def api_heartbeat():
    data = request.get_json(silent=True) or {}
    usuario_id = str(data.get("usuario_id", "")).strip()
    session_token = str(data.get("session_token", "")).strip()
    
    if not validar_token_sesion(usuario_id, session_token):
        return jsonify({"success": False, "error": "Sesión inválida"}), 401
        
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
            f"<i>¿No fuiste tú? Protege el acceso desde los botones de control.</i>"
        )
        keyboard_admin = {
            "inline_keyboard": [
                [
                    {"text": "🟢 ENCENDER", "callback_data": "system_on"},
                    {"text": "🔴 APAGAR", "callback_data": "system_off"}
                ],
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

    return jsonify({"status": "success"}), 200

@app.route("/api/notificar-logout", methods=["POST"])
def notificar_logout():
    data = request.get_json(silent=True) or {}
    usuario_id = str(data.get("usuario_id", "")).strip()
    
    if not usuario_id:
        return jsonify({"status": "error", "message": "ID no proporcionado"}), 400

    if supabase_client:
        try:
            supabase_client.table("usuarios").update({"session_token": None}).eq("id", usuario_id).execute()
        except Exception as e:
            print(f"Error borrando session_token en logout: {e}")

    if usuario_id.upper() == ADMIN_USER_ID.upper():
        mensaje = (
            f"🔴 <b>CIERRE DE SESIÓN DE ADMIN</b>\n\n"
            f"👤 <b>Usuario:</b> <code>{usuario_id}</code>\n"
            f"🚪 Ha cerrado sesión correctamente del panel."
        )
        send_telegram_message(TELEGRAM_ADMIN_CHAT_ID, mensaje)

    return jsonify({"status": "success"}), 200

@app.route("/api/verificar-admin", methods=["POST"])
def verificar_admin():
    data = request.get_json(silent=True) or {}
    usuario_id = str(data.get("usuario_id", "")).strip()

    client_ip, user_agent = obtener_datos_cliente(request)

    if usuario_id.upper() == ADMIN_USER_ID.upper():
        return jsonify({"status": "authorized"}), 200

    if supabase_client:
        try:
            usr_res = supabase_client.table("usuarios").select("*").eq("id", usuario_id).execute()
            if usr_res.data and len(usr_res.data) > 0:
                usr = usr_res.data[0]
                intentos_actuales = (usr.get("intentos_admin") or 0) + 1

                supabase_client.table("usuarios").update({
                    "intentos_admin": intentos_actuales
                }).eq("id", usuario_id).execute()

                registrar_conexion(usuario_id, f"intento_admin_denegado_{intentos_actuales}")

                send_telegram_message(TELEGRAM_ADMIN_CHAT_ID, 
                    f"⚠️ <b>¡INTENTO DE ACCESO DE USUARIO COMÚN!</b>\n\n"
                    f"👤 <b>Usuario:</b> <code>{usuario_id}</code>\n"
                    f"🌐 <b>IP:</b> <code>{client_ip or 'Desconocida'}</code>\n"
                    f"🔒 Se denegó el acceso al panel y fue redirigido al álbum.",
                    reply_markup={
                        "inline_keyboard": [
                            [
                                {"text": "🚨 Bloquear Usuario", "callback_data": f"bloquear_{usuario_id}"},
                                {"text": "🔓 Desbloquear", "callback_data": f"desbloquear_{usuario_id}"}
                            ]
                        ]
                    }
                )
        except Exception as e:
            print(f"Error procesando rechazo de usuario común: {e}")

    return jsonify({"status": "unauthorized", "message": "Acceso restringido para el administrador."}), 403
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
        return jsonify({"total_sales": 0, "bcv_rate": 1.0, "approved_count": 0, "stickers_sold": 0, "total_usuarios": 0, "usuarios_online": 0, "transacciones": []}), 200
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
            "usuarios_online": usuarios_online,
            "transacciones": transacciones
        }), 200
    except Exception as e:
        print(f"Error en admin_metricas: {e}")
        return jsonify({"error": str(e)}), 500

# 📊 NUEVO ENDPOINT DE MÉTRICAS FINANCIERAS (P&L y Devaluación)
@app.route("/api/admin/metricas-financieras", methods=["GET"])
@limiter.limit("30 per minute")
def obtener_metricas_financieras():
    if not supabase_client:
        return jsonify({"status": "error", "message": "Base de datos no disponible"}), 500

    try:
        ventas_res = supabase_client.table("transacciones").select("monto_bs, monto").eq("estado", "aprobado").execute()
        ventas_data = ventas_res.data or []

        retiros_res = supabase_client.table("retiros").select("monto_bs, monto_usd, milestone, tipo").eq("estado", "aprobado").execute()
        retiros_data = retiros_res.data or []

        total_ingresos_bs = sum(float(v.get("monto_bs") or v.get("monto") or 0) for v in ventas_data)
        
        bcv_actual = 1.0
        try:
            r_bcv = requests.get("https://ve.dolarapi.com/v1/dolares/oficial", timeout=3)
            if r_bcv.ok:
                bcv_actual = float(r_bcv.json().get("promedio", 1.0))
        except:
            pass

        total_ingresos_usd_historico = total_ingresos_bs / bcv_actual if bcv_actual > 0 else 0
        total_egresos_usd = sum(float(r.get("monto_usd", 100.0)) for r in retiros_data)

        comision_teorica_usd = total_ingresos_usd_historico * 0.30
        pozo_premios_usd = total_ingresos_usd_historico * 0.70

        ganancia_neta_usd = comision_teorica_usd - (total_egresos_usd - pozo_premios_usd if total_egresos_usd > pozo_premios_usd else 0)

        return jsonify({
            "status": "success",
            "metricas": {
                "total_ingresos_bs": round(total_ingresos_bs, 2),
                "total_ingresos_usd": round(total_ingresos_usd_historico, 2),
                "total_pagado_premios_usd": round(total_egresos_usd, 2),
                "comision_plataforma_30_usd": round(comision_teorica_usd, 2),
                "ganancia_neta_real_usd": round(ganancia_neta_usd, 2)
            }
        }), 200

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

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
@limiter.limit("3 per 5 minutes")
def notificar_compra():
    if not verificar_sistema_activo():
        return jsonify({"status": "error", "message": "La plataforma está apagada temporalmente."}), 403

    data = request.get_json(silent=True) or {}
    usuario_id = data.get("usuario_id")
    session_token = data.get("session_token")
    
    if not validar_token_sesion(usuario_id, session_token):
        return jsonify({"status": "error", "message": "Sesión inválida o expirada. Vuelve a iniciar sesión."}), 401

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
            
            if tx.get("estado") != "pendiente":
                return jsonify({"status": "error", "message": "Esta transacción ya fue procesada anteriormente."}), 400

            nuevo_estado = "aprobado" if accion == "aprobar" else "rechazado"
            
            update_payload = {"estado": nuevo_estado}
            if accion == "aprobar":
                update_payload["fecha_aprobacion"] = datetime.now(timezone.utc).isoformat()

            supabase_client.table("transacciones").update(update_payload).eq("id", tx_id).execute()

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

                    verificar_y_sumar_referido(tx["usuario_id"])

            estado_texto = "✅ APROBADO DESDE LA WEB" if accion == "aprobar" else "❌ RECHAZADO DESDE LA WEB"
            send_telegram_message(TELEGRAM_ADMIN_CHAT_ID, f"📢 <b>Actualización de Compra [ID:{tx_id}]</b>\nEstado cambiado a: <b>{estado_texto}</b>")

            return jsonify({"status": "success"}), 200
        except Exception as e:
            return jsonify({"status": "error", "message": str(e)}), 500
    return jsonify({"status": "error", "message": "Sin conexión a BD"}), 500

@app.route("/api/notificar-retiro", methods=["POST"])
@limiter.limit("10 per minute")
def notificar_retiro():
    if not verificar_sistema_activo():
        return jsonify({"status": "error", "message": "La plataforma está apagada temporalmente."}), 403

    data = request.get_json(silent=True) or {}
    usuario_id = data.get("usuario_id")
    session_token = data.get("session_token")
    
    if not validar_token_sesion(usuario_id, session_token):
        return jsonify({"status": "error", "message": "Sesión inválida o expirada."}), 401

    tipo = data.get("tipo", "hito_parcial")
    milestone = int(data.get("milestone", 0))
    monto_bs = data.get("monto_bs")
    monto_usd = data.get("monto_usd", 100.0)
    datos_pago = data.get("datos_pago")

    if not all([usuario_id, monto_bs, datos_pago]):
        return jsonify({"status": "error", "message": "Campos incompletos"}), 400

    w_id = None
    if supabase_client:
        try:
            usr_res = supabase_client.table("usuarios").select("cantidad_barajitas").eq("id", usuario_id).execute()
            if not usr_res.data:
                return jsonify({"status": "error", "message": "Usuario no encontrado."}), 404
            
            user_barajitas = int(usr_res.data[0].get("cantidad_barajitas", 0) or 0)

            if milestone > 0 and milestone < 1000 and user_barajitas < milestone:
                return jsonify({"status": "error", "message": f"No cumples con las barajitas requeridas para este hito ({user_barajitas}/{milestone})."}), 400

            if milestone > 0 and milestone < 1000:
                ret_existente = supabase_client.table("retiros").select("id, estado").eq("usuario_id", str(usuario_id)).eq("milestone", milestone).execute()
                if ret_existente.data:
                    for r in ret_existente.data:
                        if r.get("estado") in ["pendiente", "aprobado"]:
                            return jsonify({"status": "error", "message": f"Ya tienes una solicitud para el Hito #{milestone} en estado '{r.get('estado')}'."}), 400

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
                    if w["tipo"] == "liquidacion_total" or w.get("milestone", 0) >= 1000:
                        supabase_client.table("usuarios").update({"cantidad_barajitas": 0, "saldo_bs": 0.0}).eq("id", w["usuario_id"]).execute()
                    else:
                        nuevo_saldo = max(0.0, (usr.get("saldo_bs") or 0.0) - float(w["monto_bs"]))
                        supabase_client.table("usuarios").update({"saldo_bs": nuevo_saldo}).eq("id", w["usuario_id"]).execute()

            estado_texto = f"✅ APROBADO (Ref: {referencia})" if accion == "aprobar" else "❌ RECHAZADO"
            send_telegram_message(TELEGRAM_ADMIN_CHAT_ID, f"🏆 <b>Actualización de Retiro/Hito [ID:{w_id}]</b>\nEstado cambiado a: <b>{estado_texto}</b>")

            return jsonify({"status": "success"}), 200
        except Exception as e:
            return jsonify({"status": "error", "message": str(e)}), 500
    return jsonify({"status": "error", "message": "Sin conexión"}), 500

@app.route("/api/telegram-webhook", methods=["POST"])
def telegram_webhook():
    data = request.get_json(silent=True) or {}
    
    chat_id_remitente = None
    if "message" in data:
        chat_id_remitente = str(data["message"]["chat"]["id"])
    elif "callback_query" in data:
        chat_id_remitente = str(data["callback_query"]["message"]["chat"]["id"])

    if chat_id_remitente and TELEGRAM_ADMIN_CHAT_ID and chat_id_remitente != TELEGRAM_ADMIN_CHAT_ID:
        return jsonify({"status": "ignored", "reason": "Unauthorized chat"}), 200

    message = data.get("message")
    if message and message.get("text"):
        reply_to = message.get("reply_to_message")
        if reply_to and reply_to.get("text"):
            text_original = reply_to.get("text")
            match = re.search(r'\[ID:([a-fA-F0-9\-]+|\d+)\]', text_original)
            if match:
                w_id = match.group(1)
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

                            if tipo_retiro == "liquidacion_total" or milestone_val >= 1000 or tipo_retiro == "ciclo_completo":
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

    callback_query = data.get("callback_query")
    if not callback_query:
        return jsonify({"status": "ok"}), 200
        
    query_id = callback_query.get("id")
    data_str = callback_query.get("data", "")
    message_cb = callback_query.get("message", {})
    chat_id = message_cb.get("chat", {}).get("id")
    message_id = message_cb.get("message_id")
    texto_original = message_cb.get("text", "Solicitud")

    try:
        requests.post(f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/answerCallbackQuery", json={
            "callback_query_id": query_id,
            "text": "⚡ Procesando solicitud...",
            "showAlert": False
        }, timeout=3)
    except Exception as e:
        print(f"Error al responder callback inmediato: {e}")

    keyboard_admin = {
        "inline_keyboard": [
            [
                {"text": "🟢 ENCENDER", "callback_data": "system_on"},
                {"text": "🔴 APAGAR", "callback_data": "system_off"}
            ],
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

    if supabase_client:
        try:
            if data_str in ["system_on", "system_off"]:
                new_status = True if data_str == "system_on" else False
                supabase_client.table("system_config").upsert({"key": "is_online", "value": new_status}).execute()
                
                estado_txt = "🟢 PLATAFORMA ENCENDIDA Y OPERATIVA" if new_status else "🔴 PLATAFORMA APAGADA (MANTENIMIENTO)"
                requests.post(f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/editMessageText", json={
                    "chat_id": chat_id, "message_id": message_id,
                    "text": f"{texto_original}\n\n<b>ESTADO DEL SISTEMA: {estado_txt}</b>",
                    "parse_mode": "HTML", "reply_markup": keyboard_admin
                }, timeout=5)
                return jsonify({"status": "ok"}), 200

            if data_str == "bloquear_pago":
                supabase_client.table("configuracion").update({"pago_bloqueado": True}).eq("id", 1).execute()
                requests.post(f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/editMessageText", json={
                    "chat_id": chat_id, "message_id": message_id,
                    "text": f"{texto_original}\n\n<b>ESTADO: 🔒 CONFIGURACIÓN DE PAGO BLOQUEADA</b>",
                    "parse_mode": "HTML", "reply_markup": keyboard_admin
                }, timeout=5)
                return jsonify({"status": "ok"}), 200

            if data_str == "desbloquear_pago":
                supabase_client.table("configuracion").update({"pago_bloqueado": False}).eq("id", 1).execute()
                requests.post(f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/editMessageText", json={
                    "chat_id": chat_id, "message_id": message_id,
                    "text": f"{texto_original}\n\n<b>ESTADO: 🔓 CONFIGURACIÓN DE PAGO DESBLOQUEADA</b>",
                    "parse_mode": "HTML", "reply_markup": keyboard_admin
                }, timeout=5)
                return jsonify({"status": "ok"}), 200

            if data_str.startswith("bloquear_") or data_str.startswith("desbloquear_"):
                partes_usr = data_str.split("_", 1)
                accion_usr = partes_usr[0]
                target_user_id = partes_usr[1] if len(partes_usr) > 1 else ADMIN_USER_ID

                es_bloquear = (accion_usr == "bloquear")
                supabase_client.table("usuarios").update({
                    "bloqueado": es_bloquear,
                    "session_token": None if es_bloquear else None,
                    "intentos_admin": 0 if not es_bloquear else None
                }).eq("id", target_user_id).execute()

                estado_txt = "🚨 USUARIO BLOQUEADO Y EXPULSADO" if es_bloquear else "🔓 USUARIO DESBLOQUEADO"
                requests.post(f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/editMessageText", json={
                    "chat_id": chat_id, "message_id": message_id,
                    "text": f"{texto_original}\n\n<b>ESTADO: {estado_txt}</b>",
                    "parse_mode": "HTML", "reply_markup": keyboard_admin
                }, timeout=5)
                return jsonify({"status": "ok"}), 200

            if data_str.startswith("compra_") or data_str.startswith("retiro_"):
                segmentos = data_str.split("_")
                if len(segmentos) >= 3:
                    tipo_entidad = segmentos[0]
                    accion_tipo = segmentos[1]
                    item_id = "_".join(segmentos[2:])

                    if tipo_entidad == "compra":
                        tx_res = supabase_client.table("transacciones").select("*").eq("id", item_id).execute()
                        if tx_res.data:
                            tx = tx_res.data[0]
                            
                            if tx.get("estado") != "pendiente":
                                requests.post(f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/editMessageText", json={
                                    "chat_id": chat_id,
                                    "message_id": message_id,
                                    "text": f"{texto_original}\n\n<b>ESTADO: ⚠️ YA HABÍA SIDO PROCESADA ANTERIORMENTE</b>",
                                    "parse_mode": "HTML"
                                }, timeout=5)
                                return jsonify({"status": "ok"}), 200

                            nuevo_estado = "aprobado" if accion_tipo == "aprobar" else "rechazado"
                            
                            update_payload = {"estado": nuevo_estado}
                            if accion_tipo == "aprobar":
                                update_payload["fecha_aprobacion"] = datetime.now(timezone.utc).isoformat()

                            supabase_client.table("transacciones").update(update_payload).eq("id", item_id).execute()

                            if accion_tipo == "aprobar":
                                usr_res = supabase_client.table("usuarios").select("*").eq("id", tx["usuario_id"]).execute()
                                if usr_res.data:
                                    usr = usr_res.data[0]
                                    barajitas_a_sumar = int(tx.get("barajitas_qty") or 0)
                                    monto_bs_total = float(tx.get("monto_bs") or tx.get("monto") or 0.0)
                                    
                                    supabase_client.table("usuarios").update({
                                        "cantidad_barajitas": (usr.get("cantidad_barajitas") or 0) + barajitas_a_sumar,
                                        "saldo_bs": (usr.get("saldo_bs") or 0.0) + (monto_bs_total * 0.70)
                                    }).eq("id", tx["usuario_id"]).execute()

                                    verificar_y_sumar_referido(tx["usuario_id"])
                    elif tipo_entidad == "retiro":
                        w_res = supabase_client.table("retiros").select("*").eq("id", item_id).execute()
                        if w_res.data:
                            w = w_res.data[0]
                            nuevo_estado = "aprobado" if accion_tipo == "aprobar" else "rechazado"
                            supabase_client.table("retiros").update({"estado": nuevo_estado}).eq("id", item_id).execute()

                            if accion_tipo == "aprobar":
                                usr_res = supabase_client.table("usuarios").select("*").eq("id", w["usuario_id"]).execute()
                                if usr_res.data:
                                    usr = usr_res.data[0]
                                    if w["tipo"] == "liquidacion_total" or w.get("milestone", 0) >= 1000:
                                        supabase_client.table("usuarios").update({"cantidad_barajitas": 0, "saldo_bs": 0.0}).eq("id", w["usuario_id"]).execute()
                                    else:
                                        nuevo_saldo = max(0.0, (usr.get("saldo_bs") or 0.0) - float(w["monto_bs"]))
                                        supabase_client.table("usuarios").update({"saldo_bs": nuevo_saldo}).eq("id", w["usuario_id"]).execute()

                    estado_texto = "✅ APROBADO Y APLICADO" if accion_tipo == "aprobar" else "❌ RECHAZADO"
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
