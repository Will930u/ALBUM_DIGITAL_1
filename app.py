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

supabase_client: Client = None
if SUPABASE_URL and SUPABASE_KEY:
    try:
        supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
    except Exception as e:
        print(f"Error al inicializar Supabase: {e}")

def _send_telegram_async(chat_id: str, text: str, reply_markup=None):
    """Función interna que se ejecuta en segundo plano para enviar mensajes con botones a Telegram"""
    if not TELEGRAM_BOT_TOKEN or not chat_id:
        print("⚠️ [TELEGRAM] Token o Chat ID vacíos.")
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
        res = requests.post(url, json=payload, timeout=15)
        print(f"🤖 [TELEGRAM RESPONSE] Status: {res.status_code} | Body: {res.text}")
    except Exception as e:
        print(f"❌ [TELEGRAM ERROR] Excepción al conectar con la API: {e}")

def send_telegram_message(chat_id: str, text: str, reply_markup=None):
    """Dispara el mensaje a Telegram en un hilo separado (No bloquea la app)"""
    if not TELEGRAM_BOT_TOKEN or not chat_id:
        return False
    thread = threading.Thread(target=_send_telegram_async, args=(chat_id, text, reply_markup))
    thread.daemon = True
    thread.start()
    return True

@app.route("/", methods=["GET"])
def index():
    return jsonify({"status": "online", "service": "Álbum Digital Backend", "version": "3.1.4"}), 200

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

            icono = "✅" if accion == "aprobar" else "❌"
            monto_notif = float(tx.get("monto_bs") or tx.get("monto") or 0.0)
            msg = (
                f"{icono} <b>COMPRA {accion.upper()}A</b>\n\n"
                f"👤 <b>Usuario:</b> <code>{tx['usuario_id']}</code>\n"
                f"🎴 <b>Barajitas:</b> {tx.get('barajitas_qty', 0)}\n"
                f"💰 <b>Monto Bs.:</b> {monto_notif:.2f}\n"
                f"🔢 <b>Referencia:</b> <code>{tx.get('referencia', 'N/A')}</code>"
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

    w_id = None
    if supabase_client:
        try:
            res_insert = supabase_client.table("retiros").insert({
                "usuario_id": str(usuario_id),
                "tipo": str(tipo),
                "milestone": int(milestone),
                "monto_bs": float(monto_bs),
                "monto_usd": float(monto_usd),
                "datos_pago": str(datos_pago),
                "estado": "pendiente"
            }).execute()
            if res_insert.data and len(res_insert.data) > 0:
                w_id = res_insert.data[0].get("id")
        except Exception as e:
            return jsonify({"status": "error", "message": str(e)}), 500

    if tipo == "liquidacion_total":
        mensaje = f"🚨 <b>SOLICITUD DE LIQUIDACIÓN TOTAL</b> [ID:{w_id}]\n\n👤 <b>Usuario:</b> <code>{usuario_id}</code>\n💰 <b>Monto Bs.:</b> {float(monto_bs):.2f}\n📱 <b>Pago Móvil:</b> {datos_pago}\n\n<i>💬 Responde a este mensaje con el número de referencia para aprobar y pagar.</i>"
    elif tipo == "ciclo_completo":
        mensaje = f"🌟 <b>SOLICITUD DE CICLO COMPLETO (#2000)</b> [ID:{w_id}]\n\n👤 <b>Usuario:</b> <code>{usuario_id}</code>\n💰 <b>Monto Bs.:</b> {float(monto_bs):.2f}\n📱 <b>Pago Móvil:</b> {datos_pago}\n\n<i>💬 Responde a este mensaje con el número de referencia para aprobar y pagar.</i>"
    else:
        mensaje = f"🏆 <b>SOLICITUD DE PREMIO HITO (#{milestone})</b> [ID:{w_id}]\n\n👤 <b>Usuario:</b> <code>{usuario_id}</code>\n💰 <b>Monto Bs.:</b> {float(monto_bs):.2f}\n📱 <b>Pago Móvil:</b> {datos_pago}\n\n<i>💬 Responde a este mensaje con el número de referencia para aprobar y pagar.</i>"

    keyboard = {
        "inline_keyboard": [
            [
                {"text": "❌ Rechazar Directo", "callback_data": f"retiro_rechazar_{w_id}"}
            ]
        ]
    } if w_id else None

    send_telegram_message(TELEGRAM_ADMIN_CHAT_ID, mensaje, reply_markup=keyboard)
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
            if not w_res.data or len(w_res.data) == 0:
                return jsonify({"status": "error", "message": "Retiro no encontrado"}), 404
            
            w = w_res.data[0]
            nuevo_estado = "aprobado" if accion == "aprobar" else "rechazado"
            
            update_data = {"estado": nuevo_estado}
            if referencia:
                update_data["referencia"] = referencia
            
            supabase_client.table("retiros").update(update_data).eq("id", w_id).execute()

            if accion == "aprobar":
                usr_res = supabase_client.table("usuarios").select("*").eq("id", w["usuario_id"]).execute()
                if usr_res.data and len(usr_res.data) > 0:
                    usr = usr_res.data[0]
                    if w["tipo"] == "liquidacion_total" or w.get("milestone") == 2000 or w.get("milestone") >= 2000:
                        supabase_client.table("usuarios").update({
                            "cantidad_barajitas": 0,
                            "saldo_bs": 0.0
                        }).eq("id", w["usuario_id"]).execute()
                        supabase_client.table("retiros").delete().eq("usuario_id", w["usuario_id"]).execute()
                    else:
                        nuevo_saldo = max(0.0, (usr.get("saldo_bs") or 0.0) - float(w["monto_bs"]))
                        supabase_client.table("usuarios").update({
                            "saldo_bs": nuevo_saldo
                        }).eq("id", w["usuario_id"]).execute()

            icono = "✅" if accion == "aprobar" else "❌"
            msg = (
                f"{icono} <b>RETIRO / HITO {accion.upper()}O</b>\n\n"
                f"👤 <b>Usuario:</b> <code>{w['usuario_id']}</code>\n"
                f"🎯 <b>Tipo:</b> {w['tipo']} (Hito #{w.get('milestone', 0)})\n"
                f"💰 <b>Monto USD:</b> ${w['monto_usd']}\n"
                f"🔢 <b>Ref. Pago:</b> <code>{referencia or 'N/A'}</code>"
            )
            send_telegram_message(TELEGRAM_ADMIN_CHAT_ID, msg)
            return jsonify({"status": "success"}), 200
        except Exception as e:
            return jsonify({"status": "error", "message": str(e)}), 500
    return jsonify({"status": "error", "message": "Sin conexión"}), 500

@app.route("/api/telegram-webhook", methods=["POST"])
def telegram_webhook():
    data = request.get_json(silent=True) or {}
    
    # 1. SI EL ADMIN RESPONDE CON UN MENSAJE DE TEXTO (REPLY) CON LA REFERENCIA
    message = data.get("message")
    if message and message.get("text"):
        reply_to = message.get("reply_to_message")
        if reply_to and reply_to.get("text"):
            text_original = reply_to.get("text")
            # Buscar el ID del retiro en el texto (ej: [ID:12])
            import re
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
                            # Actualizar retiro como aprobado y guardar su referencia
                            supabase_client.table("retiros").update({
                                "estado": "aprobado",
                                "referencia": referencia_ingresada
                            }).eq("id", w_id).execute()

                            # Aplicar lógica de usuario (limpiar si es liquidación)
                            usr_res = supabase_client.table("usuarios").select("*").eq("id", w["usuario_id"]).execute()
                            if usr_res.data:
                                usr = usr_res.data[0]
                                if w["tipo"] == "liquidacion_total" or w.get("milestone") == 2000 or w.get("milestone") >= 2000:
                                    supabase_client.table("usuarios").update({
                                        "cantidad_barajitas": 0,
                                        "saldo_bs": 0.0
                                    }).eq("id", w["usuario_id"]).execute()
                                    supabase_client.table("retiros").delete().eq("usuario_id", w["usuario_id"]).execute()
                                else:
                                    nuevo_saldo = max(0.0, (usr.get("saldo_bs") or 0.0) - float(w["monto_bs"]))
                                    supabase_client.table("usuarios").update({
                                        "saldo_bs": nuevo_saldo
                                    }).eq("id", w["usuario_id"]).execute()

                            # Confirmar al admin en Telegram
                            send_telegram_message(chat_id, f"✅ <b>LIQUIDACIÓN APROBADA CON ÉXITO</b>\nReferencia registrada: <code>{referencia_ingresada}</code>")
                            return jsonify({"status": "ok"}), 200
                    except Exception as e:
                        print(f"Error procesando respuesta de texto de telegram: {e}")

    # 2. SI EL ADMIN PRESIONA LOS BOTONES INLINE (PARA COMPRAS O RECHAZOS DE RETIRO)
    callback_query = data.get("callback_query")
    if not callback_query:
        return jsonify({"status": "ok"}), 200

    query_id = callback_query.get("id")
    data_str = callback_query.get("data", "")
    message_cb = callback_query.get("message", {})
    chat_id = message_cb.get("chat", {}).get("id")
    message_id = message_cb.get("message_id")

    parts = data_str.split("_")
    if len(parts) >= 3:
        tipo_accion = parts[0]
        accion = parts[1]
        item_id = parts[2]

        if supabase_client:
            try:
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

                elif tipo_accion == "retiro" and accion == "rechazar":
                    w_res = supabase_client.table("retiros").select("*").eq("id", item_id).execute()
                    if w_res.data:
                        supabase_client.table("retiros").update({"estado": "rechazado"}).eq("id", item_id).execute()

                estado_texto = "✅ APROBADO Y APLICADO" if accion == "aprobar" else "❌ RECHAZADO"
                texto_original = message_cb.get("text", "Solicitud")
                nuevo_texto_tg = f"{texto_original}\n\n<b>ESTADO: {estado_texto}</b>"

                edit_url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/editMessageText"
                requests.post(edit_url, json={
                    "chat_id": chat_id,
                    "message_id": message_id,
                    "text": nuevo_texto_tg,
                    "parse_mode": "HTML"
                }, timeout=10)

                ans_url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/answerCallbackQuery"
                requests.post(ans_url, json={"callback_query_id": query_id, "text": f"¡Acción {accion} ejecutada con éxito!"}, timeout=5)

            except Exception as e:
                print(f"Error procesando callback de telegram: {e}")

    return jsonify({"status": "ok"}), 200


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
