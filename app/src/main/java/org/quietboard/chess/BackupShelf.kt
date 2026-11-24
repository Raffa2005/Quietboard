package org.quietboard.chess

import android.content.SharedPreferences
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/** PC history is shared with InstinctaZero. Merely installing or opening this
 * independent application must never create a backup in that history. */
internal class BackupShelf(
    private val store: RepertoireStore,
    private val prefs: SharedPreferences,
    private val transfer: (String?, JSONObject?) -> JSONObject,
) {
    val worker = Executors.newSingleThreadScheduledExecutor()
    private var pending: ScheduledFuture<*>? = null
    private val automatic get() = prefs.getBoolean("automatic", false)

    @Synchronized fun changed() {
        if (!automatic || worker.isShutdown) return
        pending?.cancel(false)
        pending = worker.schedule({
            // A failed upload leaves the local database authoritative. On resume
            // we compare to the *last confirmed* version and retry if necessary.
            if (automatic) runCatching { save(store.backupSnapshot(), force = false) }
        }, 2, TimeUnit.SECONDS)
    }

    private fun save(snapshot: JSONObject, force: Boolean) {
        val digest = RepertoireStore.hash(snapshot.toString().toByteArray())
        if (!force && prefs.getString("confirmed", null) == digest) return
        check(transfer(null, snapshot).optBoolean("saved")) { "PC did not confirm the backup." }
        prefs.edit().putString("confirmed", digest).apply()
    }

    fun perform(op: String, args: JSONObject): JSONObject = when (op) {
        "rep-backups" -> transfer(null, null).put("automatic", automatic)
        "rep-automatic" -> {
            check(prefs.edit().putBoolean("automatic", args.getBoolean("enabled")).commit())
            changed()
            JSONObject().put("automatic", automatic)
        }
        "rep-backup" -> {
            save(store.backupSnapshot(), force = true)
            JSONObject().put("saved", true)
        }
        "rep-restore" -> {
            val id = args.getString("version")
            require(id.matches(Regex("[a-f0-9]{64}"))) { "Unknown backup." }
            val before = store.backupSnapshot()
            // Fetch first: saving the current state can evict the oldest version.
            val requested = transfer(id, null).getJSONObject("snapshot")
            save(before, force = true)
            synchronized(store) {
                check(!worker.isShutdown && store.backupSnapshot().toString() == before.toString()) {
                    "The repertoire changed during restore. Your edits were kept."
                }
                store.restoreBackup(requested)
            }
            changed()
            store.catalog().put("settings", JSONObject(store.settings())).put("restored", true)
        }
        else -> error("Unknown backup action")
    }
    companion object {
        val actions = setOf("rep-backups", "rep-backup", "rep-restore", "rep-automatic")
    }
}
