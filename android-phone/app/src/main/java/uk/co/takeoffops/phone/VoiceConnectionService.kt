package uk.co.takeoffops.phone

import android.content.ComponentName
import android.content.Context
import android.net.Uri
import android.os.Bundle
import android.telecom.*

class VoiceConnectionService: ConnectionService() {
    override fun onCreateIncomingConnection(account: PhoneAccountHandle,request: ConnectionRequest): Connection {
        if(request.extras?.getString("sid")!=VoiceCalls.sid || VoiceCalls.phase!="ringing") return Connection.createFailedConnection(DisconnectCause(DisconnectCause.CANCELED))
        return object: Connection() {
            init {
                connectionProperties=PROPERTY_SELF_MANAGED
                setAudioModeIsVoip(true)
                setAddress(Uri.fromParts("tel",VoiceCalls.caller,null),TelecomManager.PRESENTATION_ALLOWED)
                setCallerDisplayName(VoiceCalls.label,TelecomManager.PRESENTATION_ALLOWED)
                setRinging()
            }
            override fun onShowIncomingCallUi() { VoiceCalls.showIncoming(this@VoiceConnectionService) }
            override fun onAnswer() { VoiceCalls.open(this@VoiceConnectionService,true) }
            override fun onReject() { VoiceCalls.end() }
            override fun onDisconnect() { VoiceCalls.end() }
            override fun onAbort() { VoiceCalls.end() }
            override fun onCallAudioStateChanged(state: CallAudioState) { VoiceCalls.setMuted(state.isMuted) }
        }.also { VoiceCalls.connection=it }
    }
    override fun onCreateIncomingConnectionFailed(account: PhoneAccountHandle,request: ConnectionRequest) { if(request.extras?.getString("sid")==VoiceCalls.sid) VoiceCalls.end() }
    companion object {
        fun handle(context: Context)=PhoneAccountHandle(ComponentName(context,VoiceConnectionService::class.java),"takeoff-voice")
        fun incoming(context: Context,sid: String) {
            val manager=context.getSystemService(TelecomManager::class.java)
            val handle=handle(context)
            manager.registerPhoneAccount(PhoneAccount.builder(handle,"TakeOff calls").setCapabilities(PhoneAccount.CAPABILITY_SELF_MANAGED).build())
            check(manager.isIncomingCallPermitted(handle)) { "Another call is in progress" }
            manager.addNewIncomingCall(handle,Bundle().apply { putString("sid",sid) })
        }
    }
}
