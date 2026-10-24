package uk.co.takeoffops.phone

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.*
import okhttp3.*
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** User-started remote messaging relay. No boot launch or hidden permanent task. */
class PhoneBridgeService : Service() {
    private val scope=CoroutineScope(SupervisorJob()+Dispatchers.IO)
    private val client=OkHttpClient.Builder().pingInterval(20,TimeUnit.SECONDS).build()
    private var socket: WebSocket?=null
    @Volatile private var joined=false
    private var token=""
    private val ref=AtomicInteger(1)
    private var loop: Job?=null
    private var phoneListener: android.telephony.PhoneStateListener?=null
    @Suppress("DEPRECATION") override fun onCreate() {
        super.onCreate()
        if(androidx.core.content.ContextCompat.checkSelfPermission(this,android.Manifest.permission.READ_PHONE_STATE)==android.content.pm.PackageManager.PERMISSION_GRANTED) {
            phoneListener=object: android.telephony.PhoneStateListener() {
                override fun onCallStateChanged(state: Int,number: String?) {
                    if(state==android.telephony.TelephonyManager.CALL_STATE_IDLE) android.os.Handler(mainLooper).postDelayed({ CallLogWorker.runNow(this@PhoneBridgeService) },2500)
                }
            }
            runCatching { getSystemService(android.telephony.TelephonyManager::class.java).listen(phoneListener,android.telephony.PhoneStateListener.LISTEN_CALL_STATE) }
        }
    }
    override fun onBind(intent: Intent?): IBinder?=null
    override fun onStartCommand(intent: Intent?,flags: Int,startId: Int): Int {
        if(intent?.action=="takeoff.STOP") { PhoneSession.setOnline(this,false); stopSelf(); return START_NOT_STICKY }
        if(!PhoneSession.online(this) || PhoneSession.access(this).isNullOrBlank()) { stopSelf(); return START_NOT_STICKY }
        startForeground(7001,notification("Connecting to TakeOff…"))
        if(loop==null) loop=scope.launch {
            var ticks=0
            var healthy=false
            while(isActive && PhoneSession.online(this@PhoneBridgeService)) {
                try {
                    token=SupabasePhoneApi.token(this@PhoneBridgeService)
                    if(socket==null) connect()
                    else {
                        send("phoenix","heartbeat",JSONObject())
                        send(TOPIC,"access_token",JSONObject().put("access_token",token))
                    }
                    SupabasePhoneApi.heartbeat(this@PhoneBridgeService,true)
                    PhoneSession.prefs(this@PhoneBridgeService).edit().putLong("service_tick",System.currentTimeMillis()).apply()
                    if(!healthy || ticks++%3==0) { PhoneQueueWorker.runNow(this@PhoneBridgeService); CallLogWorker.runNow(this@PhoneBridgeService) }
                    healthy=true
                    status(if(joined) "Online · listening for customer texts" else "Reconnecting · checking the queue every minute")
                } catch (_: Exception) { healthy=false; status("Connection problem · check internet and sign-in") }
                delay(20_000)
            }
        }
        return START_STICKY
    }
    private fun connect() {
        val company=PhoneSession.company(this) ?: return
        val url=BuildConfig.SUPABASE_URL.replace("https://","wss://")+"/realtime/v1/websocket?apikey="+BuildConfig.SUPABASE_ANON_KEY+"&vsn=1.0.0"
        socket=client.newWebSocket(Request.Builder().url(url).build(),object: WebSocketListener() {
            override fun onOpen(webSocket: WebSocket,response: Response) {
                val changes=JSONArray().put(JSONObject().put("event","*").put("schema","public").put("table","customer_texts").put("filter","company_id=eq.$company"))
                val payload=JSONObject().put("config",JSONObject().put("broadcast",JSONObject().put("ack",false).put("self",false)).put("presence",JSONObject().put("enabled",false)).put("postgres_changes",changes).put("private",false)).put("access_token",token)
                webSocket.send(JSONObject().put("topic",TOPIC).put("event","phx_join").put("payload",payload).put("ref","join").put("join_ref","join").toString())
            }
            override fun onMessage(webSocket: WebSocket,text: String) {
                runCatching {
                    val message=JSONObject(text); val payload=message.optJSONObject("payload") ?: JSONObject()
                    when(message.optString("event")) {
                        "phx_reply" -> if(message.optString("ref")=="join") {
                            if(payload.optString("status")=="ok") { joined=true; PhoneQueueWorker.runNow(this@PhoneBridgeService) }
                            else webSocket.cancel()
                        }
                        "postgres_changes" -> if(payload.optJSONObject("data")?.optJSONObject("record")?.optString("status")=="queued") PhoneQueueWorker.runNow(this@PhoneBridgeService)
                        "phx_error", "phx_close" -> webSocket.cancel()
                    }
                }
            }
            override fun onFailure(webSocket: WebSocket,t: Throwable,response: Response?) { disconnected(webSocket) }
            override fun onClosed(webSocket: WebSocket,code: Int,reason: String) { disconnected(webSocket) }
            override fun onClosing(webSocket: WebSocket,code: Int,reason: String) { webSocket.close(code,reason); disconnected(webSocket) }
        })
    }
    @Synchronized private fun disconnected(webSocket: WebSocket) { if(socket===webSocket) { socket=null; joined=false } }
    private fun send(topic: String,event: String,payload: JSONObject) {
        socket?.send(JSONObject().put("topic",topic).put("event",event).put("payload",payload).put("ref",ref.incrementAndGet().toString()).put("join_ref","join").toString())
    }
    private fun notification(text: String): android.app.Notification {
        val manager=getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel("takeoff-relay","Company phone connection",NotificationManager.IMPORTANCE_LOW))
        val open=PendingIntent.getActivity(this,0,Intent(this,MainActivity::class.java),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val stop=PendingIntent.getService(this,1,Intent(this,PhoneBridgeService::class.java).setAction("takeoff.STOP"),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        return NotificationCompat.Builder(this,"takeoff-relay").setSmallIcon(android.R.drawable.sym_action_chat).setContentTitle("TakeOff company phone")
            .setContentText(text).setOngoing(true).setContentIntent(open).addAction(0,"Go offline",stop).build()
    }
    private fun status(text: String) {
        PhoneSession.prefs(this).edit().putString("service_status",text).apply()
        getSystemService(NotificationManager::class.java).notify(7001,notification(text))
    }
    override fun onDestroy() {
        socket?.cancel(); socket=null; scope.cancel(); loop=null
        @Suppress("DEPRECATION")
        runCatching { phoneListener?.let { getSystemService(android.telephony.TelephonyManager::class.java).listen(it,android.telephony.PhoneStateListener.LISTEN_NONE) } }
        PhoneSession.prefs(this).edit().putLong("service_tick",0).apply()
        // Explicit stop should be visible immediately; a killed process goes stale after 90 seconds.
        Thread { runCatching { SupabasePhoneApi.heartbeat(this,false) } }.start()
        super.onDestroy()
    }
    companion object {
        private const val TOPIC="realtime:company-phone"
        fun alive(context: Context)=System.currentTimeMillis()-PhoneSession.prefs(context).getLong("service_tick",0)<90_000
    }
}
