package uk.co.takeoffops.phone

import android.Manifest
import android.app.Application
import android.content.Context
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import com.twilio.voice.RegistrationException
import com.twilio.voice.RegistrationListener
import com.twilio.voice.UnregistrationListener
import com.twilio.voice.Voice
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

class TakeOffApplication: Application() {
    override fun onCreate() { super.onCreate(); VoiceRegistration.initialize(this) }
}

object VoiceRegistration {
    private val inFlight=AtomicBoolean(false)
    private val generation=AtomicInteger(0)
    @Volatile private var retryAfter=0L
    private val main=Handler(Looper.getMainLooper())
    fun configured()=listOf(BuildConfig.VOICE_FCM_APP_ID,BuildConfig.VOICE_FCM_API_KEY,BuildConfig.VOICE_FCM_PROJECT_ID,BuildConfig.VOICE_FCM_SENDER_ID).all { it.isNotBlank() }
    fun initialize(context: Context): Boolean = try {
        if(!configured()) false else {
        if(FirebaseApp.getApps(context).isEmpty()) FirebaseApp.initializeApp(context,FirebaseOptions.Builder()
            .setApplicationId(BuildConfig.VOICE_FCM_APP_ID).setApiKey(BuildConfig.VOICE_FCM_API_KEY)
            .setProjectId(BuildConfig.VOICE_FCM_PROJECT_ID).setGcmSenderId(BuildConfig.VOICE_FCM_SENDER_ID).build())
        true
        }
    } catch(_: Exception) { false }
    fun status(context: Context)=PhoneSession.prefs(context).getString("voice_status",if(configured()) "Voice calls not registered" else "Voice calls need provider setup").orEmpty()
    private fun status(context: Context,text: String) { PhoneSession.prefs(context).edit().putString("voice_status",text).apply() }
    fun ensure(context: Context,force: Boolean=false) {
        val ctx=context.applicationContext
        if(!configured() || !PhoneSession.online(ctx) || PhoneSession.company(ctx).isNullOrBlank()) return
        if(ContextCompat.checkSelfPermission(ctx,Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED) { status(ctx,"Allow microphone access for voice calls"); return }
        if(!force && System.currentTimeMillis()-PhoneSession.prefs(ctx).getLong("voice_registered",0)<6*3600000L) return
        if(!force && System.currentTimeMillis()<retryAfter) return
        if(!inFlight.compareAndSet(false,true)) return
        retryAfter=System.currentTimeMillis()+180000
        if(!initialize(ctx)) { inFlight.set(false); return }
        val epoch=generation.get(); val company=PhoneSession.company(ctx)
        fun valid()=generation.get()==epoch && PhoneSession.online(ctx) && PhoneSession.company(ctx)==company
        status(ctx,"Registering voice calls…")
        FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
            if(!task.isSuccessful || task.result.isNullOrBlank()) { status(ctx,"Call notifications unavailable; open TakeOff to retry"); inFlight.set(false); return@addOnCompleteListener }
            val push=task.result
            Thread {
                try {
                    val token=SupabasePhoneApi.voice(ctx,"token").getString("token")
                    if(!valid()) { inFlight.set(false); return@Thread }
                    PhoneSession.prefs(ctx).edit().putString("voice_token",token).putString("voice_push",push).commit()
                    main.post {
                        if(!valid()) { inFlight.set(false); return@post }
                        try { Voice.register(token,Voice.RegistrationChannel.FCM,push,object: RegistrationListener {
                            override fun onRegistered(accessToken: String,fcmToken: String) {
                                Thread {
                                    try {
                                        if(!valid()) { unregister(ctx,token,push); return@Thread }
                                        check(SupabasePhoneApi.voice(ctx,"ready").optBoolean("ok"))
                                        if(!valid()) { unregister(ctx,token,push); return@Thread }
                                        PhoneSession.prefs(ctx).edit().putLong("voice_registered",System.currentTimeMillis()).apply()
                                        status(ctx,"Voice calls ready in TakeOff")
                                    } catch(_: Exception) { status(ctx,"Voice setup needs attention; open Voice calls") }
                                    finally { inFlight.set(false) }
                                }.start()
                            }
                            override fun onError(error: RegistrationException,accessToken: String,fcmToken: String) { status(ctx,"Call registration failed (${error.errorCode})"); inFlight.set(false) }
                        }) } catch(_: Exception) { status(ctx,"Voice registration unavailable"); inFlight.set(false) }
                    }
                } catch(e: Exception) { status(ctx,e.message?.take(200) ?: "Voice service setup required"); inFlight.set(false) }
            }.start()
        }
    }
    fun offline(context: Context) {
        generation.incrementAndGet()
        val ctx=context.applicationContext; val p=PhoneSession.prefs(ctx)
        main.post { if(VoiceCalls.phase in listOf("ringing","checking")) VoiceCalls.end() }
        p.edit().putLong("voice_registered",0).putString("voice_status","Voice calls offline").apply()
        val token=p.getString("voice_token",null); val push=p.getString("voice_push",null)
        if(token!=null && push!=null) unregister(ctx,token,push)
        // Capture credentials now: sign-out removes them, and the online flag may not be saved yet.
        val access=PhoneSession.access(ctx); val device=PhoneSession.device(ctx); val epoch=generation.get()
        if(access!=null) Thread { runCatching { if(generation.get()==epoch) SupabasePhoneApi.voiceOffline(access,device) } }.start()
    }
    private fun unregister(ctx: Context,token: String,push: String) {
        main.post { runCatching { Voice.unregister(token,Voice.RegistrationChannel.FCM,push,object: UnregistrationListener {
            override fun onUnregistered(accessToken: String,fcmToken: String) {}
            override fun onError(error: RegistrationException,accessToken: String,fcmToken: String) {}
        }) } }
    }
}
