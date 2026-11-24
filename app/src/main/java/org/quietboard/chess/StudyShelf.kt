package org.quietboard.chess

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONArray
import org.json.JSONObject

/** A cursor change updates a single study header, not the tree. The active
 * board, its nodes and its revision become durable in the same transaction. */
internal class StudyShelf(context: Context) : SQLiteOpenHelper(context, "quietboard-studies.sqlite", null, 1) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE studies(id TEXT PRIMARY KEY, meta TEXT NOT NULL, rev INTEGER NOT NULL, name TEXT NOT NULL, touched INTEGER NOT NULL, moves INTEGER NOT NULL)")
        db.execSQL("CREATE TABLE nodes(study TEXT NOT NULL, n INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(study,n)) WITHOUT ROWID")
        db.execSQL("CREATE TABLE active(slot INTEGER PRIMARY KEY, study TEXT NOT NULL)")
    }
    override fun onUpgrade(db: SQLiteDatabase, old: Int, new: Int) = error("Unsupported study version")

    @Synchronized fun read(key: String): String {
        val db=readableDatabase
        if(key=="active")return db.rawQuery("SELECT study FROM active WHERE slot=1",null).use {
            if(it.moveToFirst()) JSONObject.quote(it.getString(0)) else "null"
        }
        if(key=="index")return JSONArray().apply {
            db.rawQuery("SELECT id,name,touched,moves FROM studies ORDER BY touched DESC,rowid DESC",null).use {
                while(it.moveToNext())put(JSONObject().put("id",it.getString(0)).put("name",it.getString(1)).put("when",it.getLong(2)).put("n",it.getInt(3)))
            }
        }.toString()
        require(key.startsWith("study."))
        val id=key.removePrefix("study.")
        val meta=db.rawQuery("SELECT meta,rev FROM studies WHERE id=?", arrayOf(id)).use {
            if(!it.moveToFirst())return "null"
            JSONObject(it.getString(0)).put("_revision",it.getLong(1))
        }
        val nodes=JSONObject()
        db.rawQuery("SELECT n,data FROM nodes WHERE study=?", arrayOf(id)).use {
            while(it.moveToNext())nodes.put(it.getInt(0).toString(),JSONObject(it.getString(1)))
        }
        return meta.put("nodes",nodes).toString()
    }

    @Synchronized fun save(header: String, expected: Long, updates: String): String {
        val meta=JSONObject(header); val id=meta.getString("id")
        require(id.isNotBlank() && id.length<=200 && !meta.has("nodes"))
        val delta=JSONObject(updates); val db=writableDatabase
        db.beginTransaction()
        try {
            val (rev,oldCount)=db.rawQuery("SELECT rev,moves FROM studies WHERE id=?",arrayOf(id)).use {
                if(it.moveToFirst()) it.getLong(0) to it.getInt(1) else 0L to -1
            }
            check(rev==expected) { "Study changed elsewhere." }
            if(rev==0L)require(delta.optJSONObject("0")!=null)
            var count=oldCount
            db.compileStatement("UPDATE nodes SET data=? WHERE study=? AND n=?").use { update ->
                db.compileStatement("INSERT INTO nodes(study,n,data) VALUES(?,?,?)").use { insert ->
                    for(k in delta.keys()){
                        val n=k.toLong()
                        if(delta.isNull(k)){require(n>0);count-=db.delete("nodes","study=? AND n=?",arrayOf(id,k));continue}
                        val node=delta.getJSONObject(k); require(n>=0 && node.getLong("id")==n)
                        val value=node.toString()
                        update.bindString(1,value);update.bindString(2,id);update.bindLong(3,n)
                        if(update.executeUpdateDelete()==0){
                            insert.bindString(1,id);insert.bindLong(2,n);insert.bindString(3,value);insert.executeInsert();count++
                        }
                    }
                }
            }
            db.rawQuery("SELECT 1 FROM nodes WHERE study=? AND n=?",arrayOf(id,meta.getString("cur"))).use { require(it.moveToFirst()) }
            db.execSQL("INSERT OR REPLACE INTO studies(id,meta,rev,name,touched,moves) VALUES(?,?,?,?,?,?)",arrayOf(id,header,rev+1,meta.getString("name"),meta.getLong("when"),count))
            db.execSQL("INSERT OR REPLACE INTO active(slot,study) VALUES(1,?)",arrayOf(id))
            db.setTransactionSuccessful()
            return JSONObject().put("rev",rev+1).put("n",count).toString()
        } finally { db.endTransaction() }
    }
}
