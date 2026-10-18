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

def verificar_y_sumar_referido(usuario_comprador_id):
    if not supabase_client:
        return
    try:
        res_comprador = supabase_client.table("usuarios").select("referido_por, primera_compra_referido_hecha").eq("id", usuario_comprador_id).execute()
        if not res_comprador.data:
            return
            
        comprador = res_comprador.data[0]
        padrino_id = comprador.get("referido_por")
        ya_conto = comprador.get("primera_compra_referido_hecha", False)
        
        if padrino_id and not ya_conto:
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

@app.route("/", methods=["GET"])
def index():
    return jsonify({"status": "online", "service": "Álbum Digital Backend", "version": "4.1.0"}), 200

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

@app.route("/api/feed-actividad", methods=["GET"])
def api_feed_actividad():
    if not supabase_client:
        return jsonify({"status": "error", "message": "BD no disponible"}), 500
    try:
        tx_res = supabase_client.table("transacciones") \
            .select("id, usuario_id, barajitas_qty, monto_bs, created_at, fecha_aprobacion") \
            .eq("estado", "aprobado") \
            .order("fecha_aprobacion", desc=True) \
            .limit(15) \
            .execute()
        
        retiros_res = supabase_client.table("retiros") \
            .select("id, usuario_id, tipo, milestone, monto_bs, created_at, referencia") \
            .eq("estado", "aprobado") \
            .order("created_at", desc=True) \
            .limit(15) \
            .execute()

        actividades = []
        
        for t in (tx_res.data or []):
            actividades.append({
                "tipo": "compra",
                "usuario_id": t.get("usuario_id"),
                "detalle": f"compró {t.get('barajitas_qty')} barajitas",
                "monto_bs": t.get("monto_bs"),
                "fecha": t.get("fecha_aprobacion") or t.get("created_at")
            })

        for r in (retiros_res.data or []):
            tipo_retiro = r.get("tipo")
            milestone = r.get("milestone")
            texto_detalle = "realizó liquidación total" if tipo_retiro == "liquidacion_total" or milestone >= 1000 else f"reclamó Premio Hito #{milestone}"
            
            actividades.append({
                "tipo": "retiro",
                "usuario_id": r.get("usuario_id"),
                "detalle": texto_detalle,
                "monto_bs": r.get("monto_bs"),
                "fecha": r.get("created_at")
            })

        actividades.sort(key=lambda x: x["fecha"] or "", reverse=True)

        return jsonify({"status": "success", "actividades": actividades[:25]}), 200
    except Exception as e:
        print(f"Error en /api/feed-actividad: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

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

    user_id = f"USR-{username.upper()}"

    if not supabase_client:
        return jsonify({"error": "Error de base de datos"}), 500

    try:
        existing_user = supabase_client.table("usuarios").select("id").eq("id", user_id).execute()
        if existing_user.data and len(existing_user.data) > 0:
            return jsonify({"error": "El nombre de usuario ya está registrado."}), 400

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
    
    if not user_id or not supabase_client:
        return jsonify({"success": False, "message": "ID de usuario requerido"}), 400
        
    try:
        res = supabase_client.table("usuarios").select("cantidad_barajitas, codigo_referido, referidos_activos_mes, bonos_referidos_mes, ultimo_mes_bono").eq("id", user_id).execute()
        if not res.data:
            return jsonify({"success": False, "message": "Usuario no encontrado"}), 404
            
        user = res.data[0]
        barajitas_compradas = int(user.get("cantidad_barajitas", 0) or 0)
        
        # CANDADO DE 100 BARAJITAS PARA REFERIDOS (Ajustado proporcionalmente a 1000)
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

        link_referido = f"https://will930u.github.io/ALBUM_DIGITAL_1/album.html?ref={codigo_ref}"
        
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
        return jsonify({"error": str(e)}), 500

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
    if usuario_id.upper() == ADMIN_USER_ID.upper():
        send_telegram_message(TELEGRAM_ADMIN_CHAT_ID, f"🔐 <b>¡ACCESO DE ADMIN!</b> <code>{usuario_id}</code>")
    return jsonify({"status": "success"}), 200

@app.route("/api/notificar-logout", methods=["POST"])
def notificar_logout():
    data = request.get_json(silent=True) or {}
    usuario_id = str(data.get("usuario_id", "")).strip()
    if supabase_client and usuario_id:
        supabase_client.table("usuarios").update({"session_token": None}).eq("id", usuario_id).execute()
    return jsonify({"status": "success"}), 200

@app.route("/api/verificar-admin", methods=["POST"])
def verificar_admin():
    data = request.get_json(silent=True) or {}
    usuario_id = str(data.get("usuario_id", "")).strip()
    if usuario_id.upper() == ADMIN_USER_ID.upper():
        return jsonify({"status": "authorized"}), 200
    return jsonify({"status": "unauthorized"}), 403

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
        
        bcv_rate = 1.0
        try:
            r_bcv = requests.get("https://ve.dolarapi.com/v1/dolares/oficial", timeout=3)
            if r_bcv.ok:
                bcv_rate = float(r_bcv.json().get("promedio", 1.0))
        except:
            pass

        return jsonify({
            "total_sales": total_sales,
            "bcv_rate": bcv_rate,
            "approved_count": approved_count,
            "stickers_sold": stickers_sold,
            "total_usuarios": total_usuarios,
            "usuarios_online": len(usuarios)
        }), 200
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
            if res_insert.data:
                tx_id = res_insert.data[0].get("id")
        except Exception as e:
            return jsonify({"status": "error", "message": str(e)}), 500

    mensaje = f"🛒 <b>NUEVA COMPRA</b>\n👤 <b>Usuario:</b> {usuario_id}\n🎴 <b>Barajitas:</b> {barajitas_qty}\n💰 <b>Bs.:</b> {monto_bs}\n🔢 <b>Ref:</b> {referencia}"
    keyboard = {"inline_keyboard": [[{"text": "✅ Aprobar", "callback_data": f"compra_aprobar_{tx_id}"}, {"text": "❌ Rechazar", "callback_data": f"compra_rechazar_{tx_id}"}]]} if tx_id else None
    send_telegram_message(TELEGRAM_ADMIN_CHAT_ID, mensaje, reply_markup=keyboard)
    return jsonify({"status": "success"}), 200

@app.route("/api/procesar-compra-admin", methods=["POST"])
def procesar_compra_admin():
    data = request.get_json(silent=True) or {}
    tx_id = data.get("tx_id")
    accion = data.get("accion")
    
    if supabase_client:
        try:
            tx_res = supabase_client.table("transacciones").select("*").eq("id", tx_id).execute()
            if not tx_res.data:
                return jsonify({"status": "error", "message": "No encontrada"}), 404
            
            tx = tx_res.data[0]
            nuevo_estado = "aprobado" if accion == "aprobar" else "rechazado"
            supabase_client.table("transacciones").update({"estado": nuevo_estado, "fecha_aprobacion": datetime.now(timezone.utc).isoformat() if accion == "aprobar" else None}).eq("id", tx_id).execute()

            if accion == "aprobar":
                usr_res = supabase_client.table("usuarios").select("*").eq("id", tx["usuario_id"]).execute()
                if usr_res.data:
                    usr = usr_res.data[0]
                    barajitas_a_sumar = int(tx.get("barajitas_qty") or 0)
                    monto_bs_total = float(tx.get("monto_bs") or 0.0)
                    
                    supabase_client.table("usuarios").update({
                        "cantidad_barajitas": (usr.get("cantidad_barajitas") or 0) + barajitas_a_sumar,
                        "saldo_bs": (usr.get("saldo_bs") or 0.0) + (monto_bs_total * 0.70)
                    }).eq("id", tx["usuario_id"]).execute()

                    verificar_y_sumar_referido(tx["usuario_id"])

            return jsonify({"status": "success"}), 200
        except Exception as e:
            return jsonify({"status": "error", "message": str(e)}), 500
    return jsonify({"status": "error"}), 500

@app.route("/api/notificar-retiro", methods=["POST"])
def notificar_retiro():
    data = request.get_json(silent=True) or {}
    usuario_id = data.get("usuario_id")
    tipo = data.get("tipo", "hito_parcial")
    milestone = int(data.get("milestone", 0))
    monto_bs = data.get("monto_bs")
    datos_pago = data.get("datos_pago")

    w_id = None
    if supabase_client:
        try:
            res_insert = supabase_client.table("retiros").insert({
                "usuario_id": str(usuario_id),
                "tipo": str(tipo),
                "milestone": milestone,
                "monto_bs": float(monto_bs),
                "monto_usd": 100.0 if milestone > 0 else float(data.get("monto_usd", 0)),
                "datos_pago": str(datos_pago),
                "estado": "pendiente"
            }).execute()
            if res_insert.data:
                w_id = res_insert.data[0].get("id")
        except Exception as e:
            return jsonify({"status": "error", "message": str(e)}), 500

    tipo_texto = "LIQUIDACIÓN TOTAL" if tipo == "liquidacion_total" else f"Premio Hito (#{milestone})"
    mensaje = f"🏆 <b>SOLICITUD DE {tipo_texto}</b> [ID:{w_id}]\n👤 <b>Usuario:</b> {usuario_id}\n💰 <b>Bs.:</b> {monto_bs}\n🏦 <b>Datos:</b> {datos_pago}"
    
    keyboard = {
        "inline_keyboard": [[
            {"text": "✅ Aprobar Retiro", "callback_data": f"retiro_aprobar_{w_id}"},
            {"text": "❌ Rechazar Retiro", "callback_data": f"retiro_rechazar_{w_id}"}
        ]]
    } if w_id else None

    send_telegram_message(TELEGRAM_ADMIN_CHAT_ID, mensaje, reply_markup=keyboard)
    return jsonify({"status": "success"}), 200

@app.route("/api/telegram-webhook", methods=["POST"])
def telegram_webhook():
    # El webhook procesa botones y callbacks de Telegram estándar
    return jsonify({"status": "ok"}), 200

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
