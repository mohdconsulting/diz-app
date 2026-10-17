package app.diz

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DizTest {
    @Test fun arabicIndicDigitsBecomeAscii() {
        assertEquals("0770123", "٠٧٧٠١٢٣".asciiDigits())
        assertEquals("12345", "۱۲۳۴۵".asciiDigits())
        assertEquals(35000, "٣٥٠٠٠".intValue)
    }

    @Test fun authEmailMatchesWebAndIos() {
        assertEquals("diz.0770123@gmail.com", Config.authEmail("0770 123"))
        assertEquals("diz.0770123@gmail.com", Config.authEmail("٠٧٧٠١٢٣"))
        assertEquals("", Config.authEmail("+ "))
    }

    @Test fun priceTable() {
        assertEquals(25000, Pricing.price("junk", 1, null))
        assertEquals(50000, Pricing.price("towing", 2, "transport"))   // 60000 - 10000
    }

    @Test fun slotSelectionExtendsAndShrinks() {
        val h = Scheduling.SLOT_MS
        val a = 1_000_000_000_000L
        var s = SlotSelection().tap(a)
        assertEquals(1, s.hours)
        s = s.tap(a + h); assertEquals(2, s.hours)
        s = s.tap(a + 2 * h); assertEquals(3, s.hours)
        s = s.tap(a + 2 * h); assertEquals(2, s.hours)         // tapping the last hour shortens
        s = s.tap(a + 5 * h); assertEquals(1, s.hours)         // far away: start over
        s = s.tap(a + 5 * h); assertTrue(s.isEmpty)            // tapping the only hour clears it
    }

    @Test fun jobParsingAndAgreedWindow() {
        val o = JSONObject("""{"id":"j1","service":"junk","desc_text":"x","addr":"y","price":1000,"status":"accepted","owner_phone":"1","accepted_by_phone":"2",
            "applicants":[{"phone":"2","name":"P","price":900,"proposedStart":3600000,"proposedEnd":10800000}],
            "schedule_type":"slot","slot_start":0,"slot_end":3600000}""")
        val j = Job.from(o)
        assertEquals(3600000L to 10800000L, j.agreedWindow)       // the accepted applicant's proposal wins
        assertEquals(0L to 3600000L, j.requestedWindow)
        assertNull(Job.from(JSONObject("""{"id":"j2","service":"junk"}""")).requestedWindow)
    }
}
