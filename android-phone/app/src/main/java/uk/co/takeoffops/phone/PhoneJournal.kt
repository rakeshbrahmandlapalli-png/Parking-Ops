package uk.co.takeoffops.phone

import android.content.Context
import org.json.JSONObject

/** Persist before handing a message to the modem. Network failures never repeat a modem send. */
object PhoneJournal {
    private fun key(id: Long) = "send:$id"
    @Synchronized fun prepare(context: Context, row: JSONObject, parts: Int): JSONObject {
        val p = PhoneSession.prefs(context)
        check(!p.contains(key(row.getLong("id")))) { "A send attempt already exists on this phone." }
        row.put("device", PhoneSession.device(context)).put("started", System.currentTimeMillis()).put("parts", parts)
            .put("sent_parts", JSONObject()).put("delivered_parts", JSONObject())
        check(p.edit().putString(key(row.getLong("id")), row.toString()).commit()) { "Could not save the SMS attempt." }
        return row
    }
    @Synchronized fun callback(context: Context, id: Long, nonce: String, part: Int, delivered: Boolean, code: Int) {
        val p = PhoneSession.prefs(context)
        val row = p.getString(key(id), null)?.let { JSONObject(it) } ?: return
        if (row.getString("claim_token") != nonce || part !in 0 until row.getInt("parts")) return
        row.getJSONObject(if (delivered) "delivered_parts" else "sent_parts").put(part.toString(), code)
        p.edit().putString(key(id), row.toString()).commit()
    }
    @Synchronized fun markException(context: Context, id: Long) {
        val p=PhoneSession.prefs(context)
        val row=p.getString(key(id),null)?.let { JSONObject(it) } ?: return
        row.put("exception",true)
        p.edit().putString(key(id),row.toString()).commit()
    }
    @Synchronized fun attempts(context: Context) = PhoneSession.prefs(context).all.filterKeys { it.startsWith("send:") }.values.map { JSONObject(it as String) }
    fun outcome(row: JSONObject, now: Long = System.currentTimeMillis()): Pair<String,String>? {
        val count=row.getInt("parts"); val sent=row.getJSONObject("sent_parts"); val delivered=row.getJSONObject("delivered_parts")
        if (delivered.length()==count && delivered.keys().asSequence().all { delivered.getInt(it) == 0 }) return "delivered" to ""
        if (sent.length()==count) {
            val successes=sent.keys().asSequence().count { sent.getInt(it)==android.app.Activity.RESULT_OK }
            if (successes==count) return "sent" to ""
            if (successes==0) return "failed" to "Android reported that all SMS parts failed (codes ${sent})."
            return "uncertain" to "Only some SMS parts were sent. Check with the customer before sending again."
        }
        if (row.optBoolean("exception") || now-row.getLong("started")>120_000) return "uncertain" to "No complete send confirmation. Check the phone before sending again."
        return null
    }
    @Synchronized fun acknowledge(context: Context, id: Long, status: String) {
        val p=PhoneSession.prefs(context); val row=p.getString(key(id),null)?.let { JSONObject(it) } ?: return
        row.put("acknowledged",status)
        // Keep sent/uncertain attempts for late delivery callbacks; prune after seven days.
        if (status=="delivered" || status=="failed") p.edit().remove(key(id)).commit()
        else p.edit().putString(key(id),row.toString()).commit()
    }
    @Synchronized fun prune(context: Context) {
        val p=PhoneSession.prefs(context); val edit=p.edit(); val cutoff=System.currentTimeMillis()-7*86400000L
        attempts(context).filter { it.getLong("started")<cutoff && it.has("acknowledged") }.forEach { edit.remove(key(it.getLong("id"))) }; edit.commit()
    }
    @Synchronized fun inbound(context: Context, id: String, from: String, body: String, at: Long) {
        val row=JSONObject().put("id",id).put("from",from).put("body",body).put("at",SupabasePhoneApi.iso(at)).put("company",PhoneSession.company(context))
        check(PhoneSession.prefs(context).edit().putString("inbound:$id",row.toString()).commit())
    }
    @Synchronized fun inbox(context: Context) = PhoneSession.prefs(context).all.filterKeys { it.startsWith("inbound:") }.values.map { JSONObject(it as String) }
    @Synchronized fun inboxDone(context: Context,id: String) { PhoneSession.prefs(context).edit().remove("inbound:$id").commit() }
}
