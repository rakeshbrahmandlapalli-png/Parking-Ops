package uk.co.takeoffops.phone

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.CallLog
import androidx.core.content.ContextCompat
import androidx.work.CoroutineWorker
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters

class CallLogWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        if (PhoneSession.access(applicationContext).isNullOrBlank()) return Result.success()
        if (ContextCompat.checkSelfPermission(applicationContext, Manifest.permission.READ_CALL_LOG) != PackageManager.PERMISSION_GRANTED) return Result.success()
        return try {
            val pending = PhoneCallEvents.all(applicationContext)
            if (pending.isEmpty()) return Result.success()
            val earliest = (pending.minOf { it.at } - 60_000).toString()
            data class Entry(val number: String,val at: Long,val seconds: Int,val type: Int)
            val rows = mutableListOf<Entry>()
            val cursor = applicationContext.contentResolver.query(
                CallLog.Calls.CONTENT_URI,
                arrayOf(CallLog.Calls.NUMBER, CallLog.Calls.DATE, CallLog.Calls.DURATION, CallLog.Calls.TYPE),
                "${CallLog.Calls.DATE} >= ?",
                arrayOf(earliest),
                "${CallLog.Calls.DATE} DESC"
            )
            cursor?.use { c ->
                val number = c.getColumnIndexOrThrow(CallLog.Calls.NUMBER)
                val date = c.getColumnIndexOrThrow(CallLog.Calls.DATE)
                val duration = c.getColumnIndexOrThrow(CallLog.Calls.DURATION)
                val type = c.getColumnIndexOrThrow(CallLog.Calls.TYPE)
                while (c.moveToNext()) rows += Entry(c.getString(number).orEmpty(), c.getLong(date), c.getInt(duration), c.getInt(type))
            }
            for (event in pending.sortedBy { it.at }) {
                val matched = rows.filter { it.number.filter(Char::isDigit).takeLast(10) == event.number.filter(Char::isDigit).takeLast(10)
                    && it.type in listOf(CallLog.Calls.INCOMING_TYPE,CallLog.Calls.MISSED_TYPE,CallLog.Calls.REJECTED_TYPE,CallLog.Calls.BLOCKED_TYPE)
                    && kotlin.math.abs(it.at-event.at)<=30_000 }
                    .minByOrNull { kotlin.math.abs(it.at-event.at) } ?: continue
                rows.remove(matched)
                val seconds=matched.seconds
                val missed=matched.type!=CallLog.Calls.INCOMING_TYPE
                SupabasePhoneApi.callEvent(applicationContext, event.id, event.number, if (missed) "missed" else "answered", SupabasePhoneApi.iso(event.at), seconds)
                PhoneCallEvents.remove(applicationContext, event.id)
            }
            Result.success()
        } catch (_: SecurityException) { Result.success() }
        catch (_: Exception) { Result.retry() }
    }

    companion object {
        fun runNow(context: Context) { WorkManager.getInstance(context).enqueueUniqueWork("takeoff-call-reconcile",androidx.work.ExistingWorkPolicy.APPEND_OR_REPLACE,OneTimeWorkRequestBuilder<CallLogWorker>().build()) }
    }
}
