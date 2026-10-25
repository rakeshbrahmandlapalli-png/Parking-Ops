package uk.co.takeoffops.phone
import org.junit.Assert.*
import org.junit.Test
class VoiceIdentityTest {
    private val company="00000000-0000-0000-0000-000000000001"
    private val device="00000000-0000-0000-0000-000000000100"
    @Test fun acceptsProviderRecipientForThisCompanyAndDevice() {
        val identity="to_00000000000000000000000000000001_00000000000000000000000000000100"
        assertEquals(identity,VoiceIdentity.of(company,device))
        assertTrue(VoiceIdentity.matches(company,device,"client:$identity"))
        assertTrue(VoiceIdentity.matches(company,device,identity))
    }
    @Test fun rejectsStaleBindingAfterCompanyOrDeviceChanges() {
        val old="client:"+VoiceIdentity.of(company,device)
        assertFalse(VoiceIdentity.matches("00000000-0000-0000-0000-000000000002",device,old))
        assertFalse(VoiceIdentity.matches(company,"00000000-0000-0000-0000-000000000200",old))
    }
    @Test fun absentAndMalformedSessionsCannotAcceptCalls() {
        assertFalse(VoiceIdentity.matches(null,device,null))
        assertFalse(VoiceIdentity.matches("not-a-company",device,"client:null"))
        assertFalse(VoiceIdentity.matches(company,device,"sip:"+VoiceIdentity.of(company,device)))
    }
}
