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
class BackupShelfTest {
    @Test fun restorePreservesThePreviousLocalVersionAndSurvivesReopen() {
        val app = RuntimeEnvironment.getApplication()
        val store = RepertoireStore(app)
        val versions = mutableListOf<String>()
        val shelf = BackupShelf(store,app.getSharedPreferences("backups",0)) { id, body ->
            when {
                body != null -> { versions.add(body.toString()); JSONObject().put("saved", true) }
                id != null -> JSONObject().put("snapshot",JSONObject(versions.first()))
                else -> JSONObject().put("versions",org.json.JSONArray())
            }
        }
        try {
            shelf.changed()
            assertFalse(shelf.perform("rep-backups", JSONObject()).getBoolean("automatic"))
            val id = store.saveRepertoire(JSONObject().put("name","English").put("side","black")).getString("created_id")
            store.saveSettings(JSONObject().put("_selected",org.json.JSONArray().put(id)).toString())
            shelf.perform("rep-backup",JSONObject())
            store.saveRepertoire(JSONObject().put("id",id).put("name","Local revision"))
            val result=shelf.perform("rep-restore",JSONObject().put("version","a".repeat(64)))
            assertTrue(result.getBoolean("restored"))
            assertEquals("Local revision",JSONObject(versions.last()).getJSONObject("edits").getJSONObject("_local_repertoires").getJSONObject(id).getString("name"))
            val reopened=RepertoireStore(app)
            assertEquals("English",reopened.catalog().getJSONArray("repertoires").getJSONObject(0).getString("name"))
            assertEquals(id,JSONObject(reopened.settings()).getJSONArray("_selected").getString(0))
        } finally { shelf.worker.shutdownNow() }
    }
}
