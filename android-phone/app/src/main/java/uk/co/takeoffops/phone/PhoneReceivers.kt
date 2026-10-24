package uk.co.takeoffops.phone

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.telephony.SmsMessage

class IncomingSmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context,intent: Intent) {
        if(intent.action!=Telephony.Sms.Intents.SMS_RECEIVED_ACTION || PhoneSession.company(context).isNullOrBlank()) return
        val subscription=intent.getIntExtra(android.telephony.SubscriptionManager.EXTRA_SUBSCRIPTION_INDEX,intent.getIntExtra("subscription",-1))
        if(subscription!=android.telephony.SubscriptionManager.getDefaultSmsSubscriptionId()) return
        val messages=Telephony.Sms.Intents.getMessagesFromIntent(intent)
        if(messages.isEmpty()) return
        val from=messages.first().originatingAddress.orEmpty()
        val body=messages.joinToString("") { it.messageBody.orEmpty() }
        val at=messages.minOf { it.timestampMillis }
        PhoneJournal.inbound(context,SupabasePhoneApi.smsExternalId(from,at,body),from,body,at)
        PhoneQueueWorker.runNow(context)
        // Android's normal SMS app owns the inbox and system notification.
    }
}

class SmsResultReceiver : BroadcastReceiver() {
    @Suppress("DEPRECATION") override fun onReceive(context: Context,intent: Intent) {
        val id=intent.getLongExtra("id",-1); val nonce=intent.getStringExtra("nonce") ?: return
        if(id<0) return
        val delivered=intent.action=="takeoff.SMS_DELIVERED"
        val code=if(delivered) {
            val pdu=intent.getByteArrayExtra("pdu") ?: return
            val sms=SmsMessage.createFromPdu(pdu,intent.getStringExtra("format") ?: "3gpp") ?: return
            // 0..31 are completed delivery statuses; pending and failed reports are not success.
            if(sms.status in 0..31) 0 else return
        } else resultCode
        PhoneJournal.callback(context,id,nonce,intent.getIntExtra("part",-1),delivered,code)
        PhoneQueueWorker.runNow(context)
    }
}
