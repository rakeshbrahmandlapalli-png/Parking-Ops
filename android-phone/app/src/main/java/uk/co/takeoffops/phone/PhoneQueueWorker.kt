package uk.co.takeoffops.phone

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.telephony.SmsManager
import android.telephony.SubscriptionManager
import androidx.core.content.ContextCompat
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters

class PhoneQueueWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val ctx=applicationContext
        if (PhoneSession.access(ctx).isNullOrBlank() || PhoneSession.company(ctx).isNullOrBlank()) return Result.success()
        return try {
            // Persisted observations and results can be retried without sending another SMS.
            for (row in PhoneJournal.inbox(ctx)) {
                if (row.optString("company") != PhoneSession.company(ctx)) continue
                SupabasePhoneApi.inboundSms(ctx,row.getString("id"),row.getString("from"),row.getString("body"),row.getString("at"))
                PhoneJournal.inboxDone(ctx,row.getString("id"))
            }
            for (row in PhoneJournal.attempts(ctx)) {
                if (row.optString("company_id") != PhoneSession.company(ctx)) continue
                val outcome=PhoneJournal.outcome(row) ?: continue
                if (row.optString("acknowledged") != outcome.first) {
                    SupabasePhoneApi.finishText(ctx,row,outcome.first,outcome.second)
                    PhoneJournal.acknowledge(ctx,row.getLong("id"),outcome.first)
                }
            }
            PhoneJournal.prune(ctx)
            // Taking the phone offline stops new sends; result reconciliation continues.
            if (!PhoneSession.online(ctx) || !PhoneBridgeService.alive(ctx)) return Result.success()
            if (ContextCompat.checkSelfPermission(ctx,Manifest.permission.SEND_SMS)!=PackageManager.PERMISSION_GRANTED) return Result.success()
            val manager=smsManager(ctx) // Validate SIM selection before claiming anything.
            repeat(10) {
                val rows=SupabasePhoneApi.claimTexts(ctx)
                if (rows.length()==0) return Result.success()
                val row=rows.getJSONObject(0)
                val parts=manager.divideMessage(row.getString("body"))
                PhoneJournal.prepare(ctx,row,parts.size)
                try {
                    val sent=ArrayList<PendingIntent>(); val delivered=ArrayList<PendingIntent>()
                    for (part in parts.indices) {
                        sent += callback(ctx,row.getLong("id"),row.getString("claim_token"),part,false)
                        delivered += callback(ctx,row.getLong("id"),row.getString("claim_token"),part,true)
                    }
                    if (parts.size==1) manager.sendTextMessage(row.getString("to_number"),null,parts[0],sent[0],delivered[0])
                    else manager.sendMultipartTextMessage(row.getString("to_number"),null,parts,sent,delivered)
                    // The sent callback, not this return, confirms success.
                } catch (_: Exception) {
                    PhoneJournal.markException(ctx,row.getLong("id"))
                    SupabasePhoneApi.finishText(ctx,row,"uncertain","Could not confirm modem submission. Check the phone before sending again.")
                }
            }
            Result.success()
        } catch (_: Exception) {
            // The journal is durable. Let the next live event/watchdog/periodic job
            // retry instead of leaving new work behind exponential WorkManager backoff.
            Result.success()
        }
    }
    companion object {
        fun runNow(context: Context) {
            WorkManager.getInstance(context).enqueueUniqueWork("takeoff-phone-sync",ExistingWorkPolicy.APPEND_OR_REPLACE,OneTimeWorkRequestBuilder<PhoneQueueWorker>().build())
        }
        @Suppress("DEPRECATION") private fun smsManager(context: Context): SmsManager {
            val subId=SubscriptionManager.getDefaultSmsSubscriptionId()
            check(subId>=0) { "Choose the company SIM as the default SMS SIM in Android settings." }
            return if (Build.VERSION.SDK_INT>=31) context.getSystemService(SmsManager::class.java).createForSubscriptionId(subId)
                else SmsManager.getSmsManagerForSubscriptionId(subId)
        }
        private fun callback(context: Context,id: Long,nonce: String,part: Int,delivered: Boolean): PendingIntent {
            val intent=Intent(context,SmsResultReceiver::class.java).setAction(if(delivered) "takeoff.SMS_DELIVERED" else "takeoff.SMS_SENT")
                .setData(Uri.parse("takeoff-sms://result/$id/$nonce/$part/${if(delivered) "delivered" else "sent"}"))
                .putExtra("id",id).putExtra("nonce",nonce).putExtra("part",part)
            // The delivery PDU is filled in by the modem; the explicit receiver limits the mutable intent.
            val mutable=if (Build.VERSION.SDK_INT>=31) PendingIntent.FLAG_MUTABLE else 0
            return PendingIntent.getBroadcast(context,0,intent,PendingIntent.FLAG_UPDATE_CURRENT or if(delivered) mutable else PendingIntent.FLAG_IMMUTABLE)
        }
    }
}
