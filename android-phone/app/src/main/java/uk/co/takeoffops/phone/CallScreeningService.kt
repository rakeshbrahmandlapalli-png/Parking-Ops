package uk.co.takeoffops.phone

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.telecom.Call
import android.telecom.CallScreeningService as AndroidCallScreeningService
import androidx.core.app.NotificationCompat
import java.util.UUID
import java.util.concurrent.Executors

class CallScreeningService : AndroidCallScreeningService() {
    override fun onScreenCall(details: Call.Details) {
        val incoming = details.callDirection == Call.Details.DIRECTION_INCOMING
        val number = details.handle?.schemeSpecificPart.orEmpty()
        val at = details.creationTimeMillis.takeIf { it > 0 } ?: System.currentTimeMillis()
        val eventId = UUID.randomUUID().toString()
        // Always let the normal phone app handle the call. The company can
        // answer, decline or call back with its usual phone controls.
        respondToCall(details, CallResponse.Builder().setDisallowCall(false).setRejectCall(false)
            .setSilenceCall(false).setSkipCallLog(false).setSkipNotification(false).build())
        if (!incoming || number.isBlank() || !PhoneSession.online(this)) return
        PhoneCallEvents.remember(this, eventId, number, at)
        showIncoming(number, "", "", eventId)
        EXECUTOR.execute {
            val match = try { SupabasePhoneApi.callEvent(this, eventId, number, "ringing", SupabasePhoneApi.iso(at)) } catch (_: Exception) { null }
            if (match != null) showIncoming(number, match.optString("reg"), match.optString("name"), eventId)
        }
    }

    private fun showIncoming(number: String, reg: String, name: String, eventId: String) {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "TakeOff calls", NotificationManager.IMPORTANCE_HIGH))
        val open = PendingIntent.getActivity(this, eventId.hashCode(), Intent(this, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val title = if (reg.isNotBlank()) "Customer · $reg" else "Incoming call"
        val detail = listOf(name, number).filter { it.isNotBlank() }.joinToString(" · ")
        val note = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.sym_call_incoming)
            .setContentTitle(title)
            .setContentText(detail)
            .setStyle(NotificationCompat.BigTextStyle().bigText(detail))
            .setContentIntent(open).setAutoCancel(true).setOnlyAlertOnce(true).setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_HIGH).build()
        manager.notify(eventId.hashCode(), note)
    }

    companion object {
        private const val CHANNEL = "takeoff-calls"
        private val EXECUTOR = Executors.newSingleThreadExecutor()
    }
}

object PhoneCallEvents {
    private const val PREFS = "takeoff-pending-calls"
    data class Pending(val id: String, val number: String, val at: Long)

    fun remember(context: Context, id: String, number: String, at: Long) {
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        p.edit().putString(id, "$number|$at").apply()
    }

    fun all(context: Context): List<Pending> {
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return p.all.mapNotNull { (id, raw) ->
            val parts = (raw as? String)?.split('|') ?: return@mapNotNull null
            if (parts.size != 2) null else Pending(id, parts[0], parts[1].toLongOrNull() ?: return@mapNotNull null)
        }
    }

    fun remove(context: Context, id: String) { context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(id).apply() }
}
