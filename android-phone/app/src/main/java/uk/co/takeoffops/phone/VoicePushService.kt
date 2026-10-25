package uk.co.takeoffops.phone

import android.content.Intent
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.twilio.voice.*

class VoicePushService: FirebaseMessagingService(), MessageListener {
    override fun onNewToken(token: String) { VoiceRegistration.ensure(this,true) }
    override fun onMessageReceived(message: RemoteMessage) { Voice.handleMessage(this,message.data,this) }
    override fun onCallInvite(invite: CallInvite) {
        if(!PhoneSession.online(this) || PhoneSession.access(this).isNullOrBlank()) { invite.reject(this); return }
        try {
            ContextCompat.startForegroundService(this,Intent(this,VoiceCallService::class.java).setAction("incoming").putExtra("invite",invite))
        } catch(_: Exception) { invite.reject(this) }
    }
    override fun onCancelledCallInvite(invite: CancelledCallInvite,error: CallException?) { VoiceCalls.cancelled(invite.callSid) }
}
