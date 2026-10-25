package uk.co.takeoffops.phone

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.telecom.Connection
import android.telecom.DisconnectCause
import androidx.core.content.ContextCompat
import com.twilio.audioswitch.AudioDevice
import com.twilio.audioswitch.AudioSwitch
import com.twilio.voice.*

/** Main-thread call state. No audio is accepted until a person answers and the server rechecks access. */
object VoiceCalls: Call.Listener {
    private val main=Handler(Looper.getMainLooper())
    private lateinit var context: Context
    private var invite: CallInvite?=null
    private var call: Call?=null
    var connection: Connection?=null
    var sid: String?=null; private set
    var phase="idle"; private set
    var caller=""; private set
    var label="TakeOff call"; private set
    var detail=""; private set
    var started=0L; private set
    var muted=false; private set
    var speaker=false; private set
    private var ringtone: Ringtone?=null
    private var audio: AudioSwitch?=null
    val observers=mutableSetOf<()->Unit>()
    private fun changed() {
        if(::context.isInitialized) VoiceCallService.refresh(context)
        observers.toList().forEach { it() }
    }
    fun offer(ctx: Context,value: CallInvite): Boolean {
        if(phase !in listOf("idle","ended") || !PhoneSession.online(ctx) || !VoiceIdentity.matches(PhoneSession.company(ctx),PhoneSession.device(ctx),value.to)) { value.reject(ctx); return false }
        context=ctx.applicationContext; invite=value; sid=value.callSid; phase="ringing"
        caller=value.from.orEmpty(); val params=value.customParameters
        label=params["reg"]?.takeIf { it.isNotBlank() } ?: "TakeOff customer"
        detail=listOfNotNull(params["customer"]?.takeIf { it.isNotBlank() },when(params["choice"]) { "1"->"Landed · pressed 1"; "2"->"Dropping off · pressed 2"; else->"Office call" }).joinToString(" · ")
        started=0; muted=false; speaker=false
        try { VoiceConnectionService.incoming(context,value.callSid) } catch(_: Exception) { end(); return false }
        val expected=sid
        main.postDelayed({ if(sid==expected && phase=="ringing") end() },35000)
        changed(); return true
    }
    fun showIncoming(ctx: Context) {
        if(phase!="ringing") return
        ringtone=RingtoneManager.getRingtone(ctx,RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE))?.apply { isLooping=true; play() }
        changed()
    }
    fun open(ctx: Context,answer: Boolean=false) {
        ctx.startActivity(Intent(ctx,VoiceCallActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP).putExtra("answer",answer))
    }
    fun answer() {
        val pending=invite ?: return
        if(phase!="ringing" || !PhoneSession.online(context)) return
        if(ContextCompat.checkSelfPermission(context,Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED) return
        phase="checking"; ringtone?.stop(); changed()
        Thread {
            val allowed=runCatching { val result=SupabasePhoneApi.voice(context,"authorize"); result.optBoolean("ok") && result.optString("identity")==VoiceIdentity.of(PhoneSession.company(context),PhoneSession.device(context)) && VoiceIdentity.matches(PhoneSession.company(context),PhoneSession.device(context),pending.to) }.getOrDefault(false)
            main.post {
                if(invite!==pending || phase!="checking") return@post
                if(!allowed || !PhoneSession.online(context)) { end(); return@post }
                try {
                    phase="connecting"
                    audio=AudioSwitch(context).apply { start { _,_-> }; activate() }
                    VoiceCallService.microphone(context)
                    call=pending.accept(context,this)
                    invite=null; changed()
                } catch(_: Exception) { end() }
            }
        }.start()
    }
    fun cancelled(value: String) { main.post { if(sid==value && phase in listOf("ringing","checking")) finish(DisconnectCause.CANCELED) } }
    fun setMuted(value: Boolean) { muted=value; call?.mute(value); changed() }
    fun toggleSpeaker() {
        val switch=audio ?: return
        val device=switch.availableAudioDevices.firstOrNull { if(!speaker) it is AudioDevice.Speakerphone else it is AudioDevice.Earpiece || it is AudioDevice.WiredHeadset || it is AudioDevice.BluetoothHeadset }
        if(device!=null) { switch.selectDevice(device); speaker=!speaker; changed() }
    }
    fun end() {
        if(Looper.myLooper()!=Looper.getMainLooper()) { main.post { end() }; return }
        invite?.reject(context); invite=null
        val active=call; call=null
        active?.disconnect()
        finish(DisconnectCause.LOCAL)
    }
    private fun finish(cause: Int) {
        if(phase=="idle" || phase=="ended") return
        invite=null; call=null; phase="ended"
        ringtone?.stop(); ringtone=null
        audio?.deactivate(); audio?.stop(); audio=null
        connection?.setDisconnected(DisconnectCause(cause)); connection?.destroy(); connection=null
        changed(); context.stopService(Intent(context,VoiceCallService::class.java))
    }
    fun elapsed()=if(started>0) ((SystemClock.elapsedRealtime()-started)/1000).toInt() else 0
    override fun onRinging(call: Call) { if(this.call!==call) return; phase="connecting"; changed() }
    override fun onConnected(call: Call) { if(this.call!==call) { call.disconnect(); return }; phase="connected"; started=SystemClock.elapsedRealtime(); connection?.setActive(); changed() }
    override fun onConnectFailure(call: Call,error: CallException) { if(this.call!==call) return; finish(DisconnectCause.ERROR) }
    override fun onReconnecting(call: Call,error: CallException) { if(this.call!==call) return; phase="reconnecting"; changed() }
    override fun onReconnected(call: Call) { if(this.call!==call) return; phase="connected"; changed() }
    override fun onDisconnected(call: Call,error: CallException?) { if(this.call!==call) return; finish(if(error==null) DisconnectCause.REMOTE else DisconnectCause.ERROR) }
}
