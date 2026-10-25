package uk.co.takeoffops.phone

import android.Manifest
import android.app.AlertDialog
import android.app.role.RoleManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.work.*
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class MainActivity : AppCompatActivity() {
    private lateinit var status: TextView
    private lateinit var web: WebView
    private lateinit var online: Button
    private var lastWebToken: String?=null
    // The sign-in bridge answers only while the trusted TakeOff page is showing.
    @Volatile private var trustedPage=false
    private val executor=Executors.newSingleThreadExecutor()
    private val handler=Handler(Looper.getMainLooper())
    // A message about the last tap stays for 20 s; the 2 s status refresh used to wipe it at once.
    private var notice: String?=null
    private var noticeUntil=0L
    private fun say(msg: String) { notice=msg; noticeUntil=System.currentTimeMillis()+20000; status.text=msg }
    private val statusTick=object: Runnable { override fun run() { updateStatus(); handler.postDelayed(this,2000) } }
    private val permissions=registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { updateStatus() }
    private val role=registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { requestRuntimePermissions(); updateStatus() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setupWorkers()
        val root=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL; setBackgroundColor(0xff101827.toInt()) }
        val top=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL; setPadding(18,12,18,12) }
        top.addView(TextView(this).apply { text="TakeOff company phone"; textSize=20f; setTextColor(0xffffffff.toInt()) })
        status=TextView(this).apply { textSize=13f; setTextColor(0xffc5ccd6.toInt()); setPadding(0,6,0,8) }; top.addView(status)
        val controls=LinearLayout(this)
        controls.addView(Button(this).apply { text="Phone access"; setOnClickListener { requestAccess() } },LinearLayout.LayoutParams(0,-2,1f))
        online=Button(this).apply { setOnClickListener {
            if(PhoneSession.online(this@MainActivity)) {
                PhoneSession.setOnline(this@MainActivity,false)
                stopService(Intent(this@MainActivity,PhoneBridgeService::class.java)); updateStatus()
            } else connectPhone(false)
        } }; controls.addView(online,LinearLayout.LayoutParams(0,-2,1f)); top.addView(controls); root.addView(top)
        web=WebView(this).apply {
            settings.javaScriptEnabled=true; settings.domStorageEnabled=true; settings.allowFileAccess=false; settings.allowContentAccess=false
            addJavascriptInterface(SessionBridge(this@MainActivity),"TakeOffPhone")
            webViewClient=object: WebViewClient() {
                override fun onPageStarted(view: WebView?,url: String?,favicon: android.graphics.Bitmap?) { trustedPage=trusted(url) }
                override fun doUpdateVisitedHistory(view: WebView?,url: String?,isReload: Boolean) { trustedPage=trusted(url) }
                override fun shouldOverrideUrlLoading(view: WebView?,request: WebResourceRequest?): Boolean {
                    val uri=request?.url ?: return true
                    return uri.scheme!="https" || uri.host !in ALLOWED_HOSTS
                }
            }
            loadUrl("https://takeoff-ops.vercel.app")
        }
        root.addView(web,LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,0,1f)); setContentView(root); updateStatus()
    }
    override fun onResume() {
        super.onResume(); handler.post(statusTick)
        if(PhoneSession.online(this) && !PhoneSession.access(this).isNullOrBlank()) ContextCompat.startForegroundService(this,Intent(this,PhoneBridgeService::class.java))
        if(::web.isInitialized) web.evaluateJavascript("window.dispatchEvent(new Event('takeoff:phone-session'));",null)
        PhoneQueueWorker.runNow(this); CallLogWorker.runNow(this)
        // Asked to be paired: an owner may have approved it in Settings since.
        if(PhoneSession.pending(this) && !PhoneSession.access(this).isNullOrBlank()) connectPhone(false,true)
    }
    override fun onPause() { handler.removeCallbacks(statusTick); super.onPause() }
    override fun onDestroy() { executor.shutdown(); if(::web.isInitialized) web.destroy(); super.onDestroy() }
    private fun setupWorkers() {
        WorkManager.getInstance(this).enqueueUniquePeriodicWork("takeoff-sim-texts",ExistingPeriodicWorkPolicy.UPDATE,PeriodicWorkRequestBuilder<PhoneQueueWorker>(15,TimeUnit.MINUTES).build())
        WorkManager.getInstance(this).enqueueUniquePeriodicWork("takeoff-call-log",ExistingPeriodicWorkPolicy.UPDATE,PeriodicWorkRequestBuilder<CallLogWorker>(15,TimeUnit.MINUTES).build())
    }
    private fun requestAccess() {
        AlertDialog.Builder(this).setTitle("Allow company phone access")
            .setMessage("TakeOff uses SMS permission to send from the company SIM and match customer replies. Call screening identifies callers; call log permission distinguishes answered and missed calls. Contacts permission lets Android screen saved callers too. Your existing phone and messaging apps keep handling normal calls and the SMS inbox.")
            .setNegativeButton("Not now",null).setPositiveButton("Continue") { _,_ ->
                val rm=getSystemService(RoleManager::class.java)
                if(rm.isRoleAvailable(RoleManager.ROLE_CALL_SCREENING) && !rm.isRoleHeld(RoleManager.ROLE_CALL_SCREENING)) role.launch(rm.createRequestRoleIntent(RoleManager.ROLE_CALL_SCREENING))
                else requestRuntimePermissions()
            }.show()
    }
    private fun requestRuntimePermissions() {
        val need=mutableListOf(Manifest.permission.SEND_SMS,Manifest.permission.RECEIVE_SMS,Manifest.permission.READ_CALL_LOG,Manifest.permission.READ_CONTACTS,Manifest.permission.READ_PHONE_STATE)
        if(Build.VERSION.SDK_INT>=33) need += Manifest.permission.POST_NOTIFICATIONS
        val missing=need.filter { ContextCompat.checkSelfPermission(this,it)!=PackageManager.PERMISSION_GRANTED }
        if(missing.isNotEmpty()) permissions.launch(missing.toTypedArray())
    }
    private fun connectPhone(replace: Boolean,quiet: Boolean=false) {
        if(PhoneSession.access(this).isNullOrBlank()) { say("Sign in to TakeOff below first."); return }
        if(quiet && !online.isEnabled) return
        if(ContextCompat.checkSelfPermission(this,Manifest.permission.SEND_SMS)!=PackageManager.PERMISSION_GRANTED || ContextCompat.checkSelfPermission(this,Manifest.permission.RECEIVE_SMS)!=PackageManager.PERMISSION_GRANTED) { requestAccess(); return }
        if(android.telephony.SubscriptionManager.getDefaultSmsSubscriptionId()<0) { say("Choose the company SIM as Android's default SMS SIM first: Settings → Connections → SIM manager → Text messages."); return }
        online.isEnabled=false
        executor.execute {
            try {
                if(SupabasePhoneApi.connect(this,replace)=="pending") { runOnUiThread { online.isEnabled=true; updateStatus() }; return@execute }
                runOnUiThread {
                    notice=null; PhoneSession.setOnline(this,true)
                    ContextCompat.startForegroundService(this,Intent(this,PhoneBridgeService::class.java)); online.isEnabled=true; updateStatus()
                }
            } catch(e: Exception) { runOnUiThread {
                online.isEnabled=true; if(quiet) return@runOnUiThread
                say(e.message ?: "Could not connect. Check internet and sign in again.")
                if(!replace && e.message?.contains("Another company phone")==true) AlertDialog.Builder(this)
                    .setTitle("Replace the paired company phone?").setMessage("Only this handset will send new customer texts. The previous handset will stop claiming them. Any uncertain sends still need review.")
                    .setNegativeButton("Cancel",null).setPositiveButton("Replace phone") { _,_ -> connectPhone(true) }.show()
            } }
        }
    }
    private fun updateStatus() {
        if(!::status.isInitialized) return
        if(notice!=null && System.currentTimeMillis()<noticeUntil) { status.text=notice; return }
        val latest=PhoneSession.access(this)
        if(::web.isInitialized && latest!=lastWebToken) {
            lastWebToken=latest
            web.evaluateJavascript("window.dispatchEvent(new Event('takeoff:phone-session'));",null)
        }
        online.text=if(PhoneSession.online(this)) "Go offline" else "Go online"
        val active=PhoneSession.online(this) && PhoneBridgeService.alive(this)
        val sms=ContextCompat.checkSelfPermission(this,Manifest.permission.SEND_SMS)==PackageManager.PERMISSION_GRANTED && ContextCompat.checkSelfPermission(this,Manifest.permission.RECEIVE_SMS)==PackageManager.PERMISSION_GRANTED
        val screening=getSystemService(RoleManager::class.java).isRoleHeld(RoleManager.ROLE_CALL_SCREENING)
        val log=ContextCompat.checkSelfPermission(this,Manifest.permission.READ_CALL_LOG)==PackageManager.PERMISSION_GRANTED
        if(PhoneSession.pending(this) && !PhoneSession.online(this)) { status.text="Waiting for an owner to approve this phone: TakeOff → Settings → Customer texts → Company phone. Then tap Go online."; return }
        status.text="${if(active) PhoneSession.prefs(this).getString("service_status","Online") else "Offline · customer texts wait for this phone"}\nSMS: ${if(sms) "Allowed" else "Needs access"} · Caller ID: ${if(screening) "On" else "Needs setup"} · Call log: ${if(log) "On" else "Off"}"
    }
    private inner class SessionBridge(private val context: Context) {
        @JavascriptInterface fun setSession(access: String,refresh: String) { if(!trustedPage) return; PhoneSession.save(context,access,refresh); PhoneQueueWorker.runNow(context); CallLogWorker.runNow(context) }
        @JavascriptInterface fun latestSession(): String {
            if(!trustedPage) return "{}"
            runCatching { if(!PhoneSession.access(context).isNullOrBlank()) SupabasePhoneApi.token(context) }
            return JSONObject().put("access_token",PhoneSession.access(context)).put("refresh_token",PhoneSession.refresh(context)).toString()
        }
        @JavascriptInterface fun clearSession() { if(trustedPage) PhoneSession.clear(context) }
    }
    companion object {
        private val ALLOWED_HOSTS=setOf("takeoff-ops.vercel.app","parkingbay-ops.vercel.app")
        fun trusted(url: String?)=runCatching { val u=android.net.Uri.parse(url); u.scheme=="https" && u.host in ALLOWED_HOSTS }.getOrDefault(false)
    }
}
