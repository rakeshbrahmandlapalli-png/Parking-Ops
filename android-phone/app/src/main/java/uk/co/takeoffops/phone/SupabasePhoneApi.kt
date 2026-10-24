package uk.co.takeoffops.phone

import android.content.Context
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

object SupabasePhoneApi {
    private class HttpError(val status: Int, message: String) : Exception(message)
    private fun request(path: String, body: JSONObject, token: String): String {
        val conn = URL(BuildConfig.SUPABASE_URL + path).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"; conn.connectTimeout = 8000; conn.readTimeout = 8000; conn.doOutput = true
            conn.setRequestProperty("apikey", BuildConfig.SUPABASE_ANON_KEY)
            conn.setRequestProperty("Authorization", "Bearer $token")
            conn.setRequestProperty("Content-Type", "application/json")
            conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            if (conn.responseCode !in 200..299) {
                val error=runCatching { JSONObject(conn.errorStream.bufferedReader().use { it.readText() }).optString("message") }.getOrDefault("")
                throw HttpError(conn.responseCode,error.take(220).ifBlank { "Phone sync HTTP ${conn.responseCode}" })
            }
            return conn.inputStream.bufferedReader().use { it.readText() }
        } finally { conn.disconnect() }
    }
    @Synchronized fun token(context: Context, force: Boolean = false): String {
        val existing = PhoneSession.access(context) ?: error("Open TakeOff and sign in first.")
        val expires = runCatching { JSONObject(String(Base64.decode(existing.split('.')[1], Base64.URL_SAFE or Base64.NO_WRAP))).getLong("exp") }.getOrDefault(0)
        if (!force && expires > System.currentTimeMillis() / 1000 + 90) return existing
        val refresh = PhoneSession.refresh(context) ?: error("Sign in again.")
        val result = JSONObject(request("/auth/v1/token?grant_type=refresh_token", JSONObject().put("refresh_token", refresh), BuildConfig.SUPABASE_ANON_KEY))
        PhoneSession.save(context, result.getString("access_token"), result.getString("refresh_token"))
        return result.getString("access_token")
    }
    fun rpc(context: Context, name: String, args: JSONObject): String {
        val used = token(context)
        return try { request("/rest/v1/rpc/$name", args, used) }
        catch (e: HttpError) {
            if (e.status != 401) throw e
            // A concurrent worker may already have refreshed this token.
            val latest = if (PhoneSession.access(context) != used) token(context) else token(context, true)
            request("/rest/v1/rpc/$name", args, latest)
        }
    }
    /** "paired", or "pending" while an owner hasn't approved this handset in Settings yet. */
    fun connect(context: Context, replace: Boolean = false): String {
        val result = JSONObject(rpc(context, "phone_connect", JSONObject().put("p_device", PhoneSession.device(context)).put("p_replace", replace)))
        val status = result.getString("status")
        val edit = PhoneSession.prefs(context).edit().putBoolean("pending", status == "pending")
        if (status == "paired") edit.putString("company", result.getString("company")) else edit.remove("company")
        edit.commit()
        return status
    }
    fun heartbeat(context: Context, ready: Boolean) {
        val battery = context.getSystemService(android.os.BatteryManager::class.java).getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY)
        val sms = android.telephony.SubscriptionManager.getDefaultSmsSubscriptionId() >= 0 && androidx.core.content.ContextCompat.checkSelfPermission(context, android.Manifest.permission.SEND_SMS) == android.content.pm.PackageManager.PERMISSION_GRANTED &&
            androidx.core.content.ContextCompat.checkSelfPermission(context, android.Manifest.permission.RECEIVE_SMS) == android.content.pm.PackageManager.PERMISSION_GRANTED
        val rm = context.getSystemService(android.app.role.RoleManager::class.java)
        val calls = rm.isRoleHeld(android.app.role.RoleManager.ROLE_CALL_SCREENING) && androidx.core.content.ContextCompat.checkSelfPermission(context, android.Manifest.permission.READ_CALL_LOG) == android.content.pm.PackageManager.PERMISSION_GRANTED
        rpc(context, "phone_heartbeat", JSONObject().put("p_device", PhoneSession.device(context)).put("p_ready", ready).put("p_sms", sms).put("p_calls", calls).put("p_battery", battery))
    }
    fun claimTexts(context: Context) = JSONArray(rpc(context, "phone_texts_claim", JSONObject().put("p_device", PhoneSession.device(context))))
    fun finishText(context: Context, row: JSONObject, status: String, error: String = "") {
        rpc(context, "phone_texts_finish", JSONObject().put("p_device", row.getString("device")).put("p_id", row.getLong("id")).put("p_token", row.getString("claim_token")).put("p_status", status).put("p_error", error))
    }
    fun inboundSms(context: Context, eventId: String, from: String, body: String, at: String) {
        rpc(context, "phone_sms_inbound", JSONObject().put("p_external", eventId).put("p_from", from).put("p_body", body).put("p_at", at))
    }
    fun callEvent(context: Context, eventId: String, from: String, status: String, at: String, seconds: Int? = null): JSONObject {
        val args = JSONObject().put("p_event", eventId).put("p_from", from).put("p_status", status).put("p_at", at)
        if (seconds != null) args.put("p_seconds", seconds)
        return JSONObject(rpc(context, "phone_call_event", args))
    }
    fun iso(atMillis: Long) = java.time.Instant.ofEpochMilli(atMillis).toString()
    fun smsExternalId(from: String, at: Long, body: String): String = "sms:" + java.security.MessageDigest.getInstance("SHA-256")
        .digest("$from|$at|$body".toByteArray()).take(16).joinToString("") { "%02x".format(it) }
}
