package uk.co.takeoffops.phone

/** Same identity as private.voice_identity; stale bindings must not cross a sign-in/company change. */
object VoiceIdentity {
    private val uuid=Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
    fun of(company: String?,device: String?): String? {
        if(company==null || device==null || !uuid.matches(company) || !uuid.matches(device)) return null
        return "to_"+company.replace("-","").lowercase()+"_"+device.replace("-","").lowercase()
    }
    fun matches(company: String?,device: String?,recipient: String?): Boolean {
        val expected=of(company,device) ?: return false
        return recipient?.removePrefix("client:")==expected
    }
}
