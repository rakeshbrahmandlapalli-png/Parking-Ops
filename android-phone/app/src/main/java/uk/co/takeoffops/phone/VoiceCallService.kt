package uk.co.takeoffops.phone

import android.app.*
import android.content.Intent
import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.twilio.voice.CallInvite

class VoiceCallService: Service() {
    override fun onBind(intent: Intent?): IBinder?=null
    override fun onCreate() {
        super.onCreate(); running=this
        getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel("takeoff-voice","TakeOff calls",NotificationManager.IMPORTANCE_HIGH).apply { description="Incoming and active customer calls"; setSound(null,null) })
    }
    override fun onStartCommand(intent: Intent?,flags: Int,startId: Int): Int {
        if(intent?.action=="end") { VoiceCalls.end(); stopSelf(); return START_NOT_STICKY }
        if(intent?.action=="incoming") {
            @Suppress("DEPRECATION") val invite=intent.getParcelableExtra<CallInvite>("invite")
            if(invite!=null && VoiceCalls.phase !in listOf("idle","ended")) {
                if(invite.callSid!=VoiceCalls.sid) invite.reject(this)
                return START_NOT_STICKY
            }
            ServiceCompat.startForeground(this,7100,notification(),ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL)
            if(invite==null || !VoiceCalls.offer(this,invite)) { if(VoiceCalls.phase in listOf("idle","ended")) stopSelf() }
        } else if(VoiceCalls.phase in listOf("idle","ended")) stopSelf()
        return START_NOT_STICKY
    }
    private fun notification(): Notification {
        fun activity(answer: Boolean)=PendingIntent.getActivity(this,if(answer) 7102 else 7101,Intent(this,VoiceCallActivity::class.java).putExtra("answer",answer).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val end=PendingIntent.getService(this,7103,Intent(this,VoiceCallService::class.java).setAction("end"),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val incoming=VoiceCalls.phase=="ringing"
        val n=NotificationCompat.Builder(this,"takeoff-voice").setSmallIcon(android.R.drawable.sym_call_incoming)
            .setContentTitle(VoiceCalls.label).setContentText(if(incoming) VoiceCalls.detail else "TakeOff · ${VoiceCalls.phase}")
            .setCategory(NotificationCompat.CATEGORY_CALL).setPriority(NotificationCompat.PRIORITY_MAX).setOngoing(true)
            .setContentIntent(activity(false)).setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
        if(incoming) {
            n.addAction(0,"Answer",activity(true)).addAction(0,"Decline",end)
            if(Build.VERSION.SDK_INT<34 || getSystemService(NotificationManager::class.java).canUseFullScreenIntent()) n.setFullScreenIntent(activity(false),true)
        } else n.addAction(0,"End call",end)
        return n.build()
    }
    override fun onDestroy() { if(running===this) { running=null; VoiceCalls.end() }; super.onDestroy() }
    companion object {
        private var running: VoiceCallService?=null
        fun refresh(context: Context) { running?.let { context.getSystemService(NotificationManager::class.java).notify(7100,it.notification()) } }
        fun microphone(context: Context) { running?.let { ServiceCompat.startForeground(it,7100,it.notification(),ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE) } }
    }
}
