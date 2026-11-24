package org.quietboard.chess

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class StudyShelfTest {
    @Test fun cursorAndNestedEditsReopenWithoutRewritingTheTreeOrLosingAStaleWrite() {
        val app=RuntimeEnvironment.getApplication()
        val header=JSONObject("""{"id":"test","name":"Study","cur":0,"when":1}""")
        val tree=JSONObject("""{"0":{"id":0,"kids":[1]},"1":{"id":1,"kids":[2]},"2":{"id":2,"kids":[],"note":"Keep me"}}""")
        StudyShelf(app).use { db ->
            db.save(header.toString(),0,tree.toString())
            db.save(header.put("cur",2).toString(),1,"{}")
            assertTrue(runCatching {db.save(header.put("cur",1).toString(),1,"{}")}.isFailure)
        }
        StudyShelf(app).use { db ->
            val s=JSONObject(db.read("study.test"))
            assertEquals(2,s.getInt("cur"))
            assertEquals("Keep me",s.getJSONObject("nodes").getJSONObject("2").getString("note"))
            val result=db.save(header.toString(),2,"""{"1":{"id":1,"kids":[]},"2":null}""")
            assertEquals(1,JSONObject(result).getInt("n"))
            assertFalse(JSONObject(db.read("study.test")).getJSONObject("nodes").has("2"))
            assertEquals("\"test\"",db.read("active"))
        }
    }
}
