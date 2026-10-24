package uk.co.takeoffops.phone

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class PhoneJournalTest {
    private fun row(parts: Int=2)=JSONObject().put("parts",parts).put("started",1000L).put("sent_parts",JSONObject()).put("delivered_parts",JSONObject())
    @Test fun submissionDoesNotMeanSent() { assertNull(PhoneJournal.outcome(row(),2000)) }
    @Test fun incompleteMultipartWaitsForEveryCallback() {
        val r=row();r.getJSONObject("sent_parts").put("0",-1)
        assertNull(PhoneJournal.outcome(r,2000))
    }
    @Test fun everyPartMustSucceed() {
        val r=row();r.getJSONObject("sent_parts").put("0",-1).put("1",-1)
        assertEquals("sent",PhoneJournal.outcome(r,2000)?.first)
    }
    @Test fun partialSuccessCannotBeBlindlyRetried() {
        val r=row();r.getJSONObject("sent_parts").put("0",-1).put("1",4)
        assertEquals("uncertain",PhoneJournal.outcome(r,2000)?.first)
    }
    @Test fun allPartFailuresAreReported() {
        val r=row();r.getJSONObject("sent_parts").put("0",4).put("1",4)
        assertEquals("failed",PhoneJournal.outcome(r,2000)?.first)
    }
    @Test fun lostCallbacksNeedReview() { assertEquals("uncertain",PhoneJournal.outcome(row(),122000)?.first) }
    @Test fun deliveryCanConfirmEvenIfSentCallbackWasLost() {
        val r=row();r.getJSONObject("delivered_parts").put("0",0).put("1",0)
        assertEquals("delivered",PhoneJournal.outcome(r,2000)?.first)
    }
    @Test fun oneDeliveryPartIsNotEnough() {
        val r=row();r.getJSONObject("delivered_parts").put("0",0)
        assertNull(PhoneJournal.outcome(r,2000))
    }
}
