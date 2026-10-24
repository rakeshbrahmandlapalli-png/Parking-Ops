package uk.co.takeoffops.phone

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.util.UUID

object PhoneSession {
    private var cached: android.content.SharedPreferences? = null
    @Synchronized fun prefs(context: Context): android.content.SharedPreferences = cached ?: EncryptedSharedPreferences.create(
        context.applicationContext, "takeoff-phone-session",
        MasterKey.Builder(context.applicationContext).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    ).also { cached = it }
    @Synchronized fun save(context: Context, access: String, refresh: String) {
        if (access.length < 80 || refresh.length < 20) return
        val previous=PhoneSession.access(context)
        fun subject(token: String) = runCatching { org.json.JSONObject(String(android.util.Base64.decode(token.split('.')[1],android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP))).getString("sub") }.getOrNull()
        if(previous!=null && subject(previous)!=subject(access)) {
            prefs(context).edit().remove("company").remove("pending").putBoolean("online",false).commit()
            context.stopService(android.content.Intent(context,PhoneBridgeService::class.java))
        }
        prefs(context).edit().putString("access", access).putString("refresh", refresh).commit()
    }
    fun access(context: Context) = prefs(context).getString("access", null)
    fun refresh(context: Context) = prefs(context).getString("refresh", null)
    @Synchronized fun device(context: Context): String = prefs(context).getString("device", null) ?: UUID.randomUUID().toString().also {
        prefs(context).edit().putString("device", it).commit()
    }
    fun company(context: Context) = prefs(context).getString("company", null)
    fun pending(context: Context) = prefs(context).getBoolean("pending", false)
    /** Active SIMs, or -1 when Android won't say (no phone-state permission). */
    fun activeSims(context: Context): Int {
        if (androidx.core.content.ContextCompat.checkSelfPermission(context, android.Manifest.permission.READ_PHONE_STATE) != android.content.pm.PackageManager.PERMISSION_GRANTED) return -1
        return try { context.getSystemService(android.telephony.SubscriptionManager::class.java).activeSubscriptionInfoCount } catch (_: SecurityException) { -1 }
    }
    fun online(context: Context) = prefs(context).getBoolean("online", false)
    fun setOnline(context: Context, on: Boolean) { prefs(context).edit().putBoolean("online", on).commit() }
    fun clear(context: Context) {
        // Keep the durable SMS journal until outstanding modem callbacks have resolved.
        prefs(context).edit().remove("access").remove("refresh").remove("company").remove("pending").putBoolean("online", false).commit()
        context.stopService(android.content.Intent(context, PhoneBridgeService::class.java))
    }
}
