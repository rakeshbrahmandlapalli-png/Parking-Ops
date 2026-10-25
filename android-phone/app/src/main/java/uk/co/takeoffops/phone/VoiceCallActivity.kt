package uk.co.takeoffops.phone

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.*
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat

class VoiceCallActivity: AppCompatActivity() {
    private lateinit var root: LinearLayout
    private val main=Handler(Looper.getMainLooper())
    private var autoAnswer=false
    private val redraw: ()->Unit={ render() }
    private val tick=object: Runnable { override fun run() { render(); main.postDelayed(this,1000) } }
    private val permission=registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        if(autoAnswer && ContextCompat.checkSelfPermission(this,Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED) { autoAnswer=false; VoiceCalls.answer() }
        VoiceRegistration.ensure(this,true); render()
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState); setShowWhenLocked(true); setTurnScreenOn(true)
        root=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL; setPadding(30,54,30,30); setBackgroundColor(0xff101827.toInt()) }
        setContentView(root); onNewIntent(intent)
    }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); if(intent.getBooleanExtra("answer",false)) answer() }
    override fun onResume() { super.onResume(); VoiceCalls.observers.add(redraw); main.post(tick) }
    override fun onPause() { VoiceCalls.observers.remove(redraw); main.removeCallbacks(tick); super.onPause() }
    private fun access() {
        val permissions=mutableListOf(Manifest.permission.RECORD_AUDIO)
        if(Build.VERSION.SDK_INT>=31) permissions.add(Manifest.permission.BLUETOOTH_CONNECT)
        if(Build.VERSION.SDK_INT>=33) permissions.add(Manifest.permission.POST_NOTIFICATIONS)
        permission.launch(permissions.toTypedArray())
    }
    private fun answer() {
        if(ContextCompat.checkSelfPermission(this,Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED) { autoAnswer=true; access() }
        else VoiceCalls.answer()
    }
    private fun render() {
        root.removeAllViews()
        fun text(value: String,size: Float=18f) { root.addView(TextView(this).apply { text=value; textSize=size; setTextColor(0xffffffff.toInt()); setPadding(0,12,0,20) }) }
        fun button(label: String,action: ()->Unit) { root.addView(Button(this).apply { text=label; setOnClickListener { action() } }) }
        text("TakeOff calls",24f)
        if(VoiceCalls.phase in listOf("idle","ended")) {
            text(if(VoiceCalls.phase=="ended") "Call ended" else "Calls answered inside TakeOff")
            text(VoiceRegistration.status(this),16f)
            text("The caller menu needs an approved voice service and an internet connection on this phone. Your existing company SIM still sends texts.",16f)
            if(VoiceRegistration.configured() && PhoneSession.online(this)) button("Enable / retry voice calls") { access(); VoiceRegistration.ensure(this,true) }
            else text("Ask the owner to finish voice setup, then sign in and Go online on this approved company phone.",16f)
            button("Back to board") { finish() }
            return
        }
        text(VoiceCalls.label,30f); text(VoiceCalls.caller); text(VoiceCalls.detail,16f)
        val seconds=VoiceCalls.elapsed(); text(VoiceCalls.phase.replaceFirstChar { it.uppercase() }+if(seconds>0) " · ${seconds/60}:${(seconds%60).toString().padStart(2,'0')}" else "")
        if(VoiceCalls.phase=="ringing") { button("Answer") { answer() }; button("Decline") { VoiceCalls.end() } }
        else {
            if(VoiceCalls.phase in listOf("connected","reconnecting")) {
                button(if(VoiceCalls.muted) "Unmute" else "Mute") { VoiceCalls.setMuted(!VoiceCalls.muted) }
                button(if(VoiceCalls.speaker) "Use earpiece / headset" else "Speaker") { VoiceCalls.toggleSpeaker() }
            }
            button("End call") { VoiceCalls.end() }
        }
        button("Open board") { startActivity(Intent(this,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)) }
    }
}
