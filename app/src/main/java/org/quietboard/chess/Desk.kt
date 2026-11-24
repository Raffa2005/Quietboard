package org.quietboard.chess

import android.app.Activity
import android.os.Bundle
import android.os.Build
import android.content.Intent
import android.net.Uri
import android.graphics.Color
import android.view.View
import android.view.WindowInsets
import android.webkit.*
import android.content.ClipboardManager
import android.content.ClipData
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONObject
import org.json.JSONArray
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicReference
import java.io.ByteArrayInputStream

private const val ORIGIN = "https://quietboard.invalid"
private const val GATE = "https://instinctazero.rs-industries.org/api/mobile/v1/"
class Desk : Activity() {
    private lateinit var page: WebView
    private val jobs = Executors.newFixedThreadPool(3)
    private val searches = Executors.newSingleThreadExecutor()
    private val books = Executors.newSingleThreadExecutor()
    private val downloads by lazy { StockfishDownloads(java.io.File(filesDir,"engines"),OkHttpClient.Builder().build()) }
    private val rest = GatewayHttpPolicy.restClient().newBuilder().followRedirects(false).followSslRedirects(false).build()
    private val stream = GatewayHttpPolicy.streamClient(rest)
    private val active = AtomicReference<Call?>()
    @Volatile private var searchId = -1
    @Volatile private var visible = false
    private val prefs by lazy {
        val key = MasterKey.Builder(this).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        EncryptedSharedPreferences.create(this,"quietboard.connection",key,EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM)
    }
    private val phone by lazy { LichessPhone(prefs) }
    private val library by lazy { RepertoireStore(this) }
    private val studyDb = lazy { StudyShelf(this) }
    private val studies by studyDb
    private val shelf by lazy {
        BackupShelf(library, getSharedPreferences("book_backup", MODE_PRIVATE)) { id, body ->
            val url = request("repertoire-backups", body, query = if (id == null) emptyMap() else mapOf("snapshot" to id))
            rest.newCall(url).execute().use { res ->
                check(res.isSuccessful) { "PC backup unavailable. Local repertoire edits are unchanged." }
                JSONObject(res.body.boundedString(12 * 1024 * 1024 + 1024))
            }
        }
    }
    private val owner get()=prefs.getString("owner","").orEmpty()
    private fun denied() = WebResourceResponse("text/plain","UTF-8",403,"Blocked",emptyMap(),ByteArrayInputStream(ByteArray(0)))
    private fun asset(uri: Uri): WebResourceResponse {
        if(uri.scheme!="https" || uri.authority!="quietboard.invalid")return denied()
        val path = uri.path.orEmpty().removePrefix("/")
        if(path.startsWith("fish/"))return downloads.response(uri.toString())?:denied()
        if(!Regex("[A-Za-z0-9_/.-]+").matches(path) || path.contains(".."))return denied()
        val mime = when(path.substringAfterLast('.')) {
            "html"->"text/html";"js"->"application/javascript";"css"->"text/css";"svg"->"image/svg+xml";"wasm"->"application/wasm";"txt","md"->"text/plain";else->return denied()
        }
        return try { WebResourceResponse(mime,if(mime=="application/wasm")null else "UTF-8",200,"OK",mapOf("X-Content-Type-Options" to "nosniff"),assets.open(path)) } catch(_:Exception){denied()}
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val ink=Color.rgb(247,247,239)
        window.statusBarColor=ink; window.navigationBarColor=ink
        window.decorView.systemUiVisibility=View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        page=WebView(this)
        page.setBackgroundColor(ink)
        if(Build.VERSION.SDK_INT>=35) page.setOnApplyWindowInsetsListener { v,i ->
            val p=i.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout() or WindowInsets.Type.ime())
            v.setPadding(p.left,p.top,p.right,p.bottom);i
        }
        setContentView(page)
        page.settings.apply { javaScriptEnabled=true;domStorageEnabled=true;allowFileAccess=false;allowContentAccess=false;javaScriptCanOpenWindowsAutomatically=false;mixedContentMode=WebSettings.MIXED_CONTENT_NEVER_ALLOW;setSupportMultipleWindows(false) }
        CookieManager.getInstance().setAcceptCookie(false)
        page.webViewClient=object:WebViewClient(){
            override fun shouldOverrideUrlLoading(v:WebView,r:WebResourceRequest)=true
            override fun shouldInterceptRequest(v:WebView,r:WebResourceRequest)=asset(r.url)
        }
        page.addJavascriptInterface(Port(),"Desk")
        page.loadUrl(ORIGIN+"/index.html")
        oauth(intent)
    }
    private fun js(body:String){runOnUiThread { if(!isDestroyed)page.evaluateJavascript(body,null) }}
    private fun reply(id:Int,value:JSONObject,fail:Boolean=false)=js("window.answer&&answer("+id+","+JSONObject.quote(value.toString())+","+fail+")")
    private fun oauth(intent:Intent?) {
        val uri=intent?.data ?:return
        if(uri.toString().substringBefore('?')!=LichessPhone.REDIRECT)return
        jobs.execute { val msg=runCatching { phone.finish(uri,owner,::direct); "Lichess connected" }.getOrElse { "Lichess connection failed" }
            runOnUiThread { android.widget.Toast.makeText(this,msg,android.widget.Toast.LENGTH_SHORT).show();js("window.connectionChanged&&connectionChanged()") } }
    }
    override fun onNewIntent(intent:Intent){super.onNewIntent(intent);oauth(intent)}
    override fun onResume(){super.onResume();visible=true;page.onResume();shelf.changed();js("window.foreground&&foreground(true)")}
    override fun onPause(){visible=false;searchId=-1;active.getAndSet(null)?.cancel();js("window.foreground&&foreground(false)");page.onPause();super.onPause()}
    override fun onBackPressed(){page.evaluateJavascript("window.dismiss&&dismiss()"){ if(it!="true")super.onBackPressed() }}
    override fun onDestroy(){active.getAndSet(null)?.cancel();shelf.worker.shutdownNow();rest.dispatcher.cancelAll();jobs.shutdownNow();books.shutdown();searches.shutdownNow();page.removeJavascriptInterface("Desk");page.destroy();if(studyDb.isInitialized())studies.close();super.onDestroy()}
    private fun direct(r:Request):String {
        require(r.url.isHttps && r.url.host in setOf("lichess.org","explorer.lichess.org"))
        rest.newCall(r).execute().use { res ->
            if(res.code==401){phone.forgetRejected(r.header("Authorization"));throw LichessUnauthorized()}
            check(res.isSuccessful){"Lichess unavailable ("+res.code+")"}
            return res.body.boundedString(2*1024*1024)
        }
    }
    private fun request(path:String,data:JSONObject?=null,auth:Boolean=true,query:Map<String,String> = emptyMap()):Request{
        val url=(GATE+path).toHttpUrl().newBuilder().apply { query.forEach{(k,v)->addQueryParameter(k,v)} }.build()
        return Request.Builder().url(url).apply{
            if(auth)header("Authorization","Bearer "+(prefs.getString("token",null)?:error("Pair your PC first")))
            if(data!=null)post(GatewayHttpPolicy.nonReplayable(data.toString().toRequestBody("application/json".toMediaType())))
        }.build()
    }
    private fun json(r:Request):JSONObject=rest.newCall(r).execute().use{
        val body=it.body.boundedString(3*1024*1024)
        check(it.isSuccessful){ runCatching { JSONObject(body).optString("error").take(170) }.getOrNull()?.takeIf(String::isNotBlank) ?: "PC unavailable ("+it.code+")" }
        JSONObject(body)
    }
    private fun connection()=JSONObject().put("paired",prefs.contains("token")).put("owner",owner).put("direct",phone.connected(owner)).put("accounts",JSONArray(prefs.getString("accounts","[]")))
    private fun session(s:JSONObject):JSONObject {
        check(prefs.edit().putString("owner",s.optJSONObject("account")?.optString("username").orEmpty()).putString("accounts",(s.optJSONArray("accounts")?:JSONArray()).toString()).commit())
        return connection()
    }
    private fun position(arg:JSONObject):JSONObject {
        val history=arg.getJSONArray("history");require(history.length()<=512)
        for(i in 0 until history.length())require(history.getString(i).matches(Regex("[a-h][1-8][a-h][1-8][qrbn]?")))
        return JSONObject().put("history",history).apply{
            if(arg.has("game_id"))put("game_id",arg.getString("game_id").also{require(it.matches(Regex("[a-zA-Z0-9]{8,16}")))})
            else if(arg.has("initial_fen"))put("initial_fen",arg.getString("initial_fen").also{require(it.length in 12..120)})
        }
    }
    private fun action(op:String,a:JSONObject):JSONObject = when(op){
        "packs"->JSONObject().put("lite",downloads.installed("lite")).put("full",downloads.installed("full"))
        "install"->{downloads.install(a.getString("pack"));JSONObject().put("lite",downloads.installed("lite")).put("full",downloads.installed("full"))}
        "state"->connection()
        "pair"->{val code=a.getString("code").trim();require(code.matches(Regex("[A-Za-z0-9 -]{4,18}")))
            val s=json(request("pair/claim",JSONObject().put("code",code).put("device_name","Quietboard"),false))
            val token=s.getString("token");require(token.length in 8..512)
            check(prefs.edit().putString("token",token).putString("owner",s.optJSONObject("server")?.optString("account_username").orEmpty()).commit())
            connection()}
        "accounts"->session(json(request("session")))
        "select"->{ val s=json(request("account/select",JSONObject().put("username",a.getString("name").take(40))));phone.forget();session(s)}
        "disconnect"->{val r=request("session").newBuilder().delete().build();phone.forget();check(prefs.edit().clear().commit()); runCatching {json(r)};connection()}
        "direct"->{val u=phone.authorize(owner);runOnUiThread { startActivity(Intent(Intent.ACTION_VIEW,u)) };connection()}
        "sync"->json(request("sync",JSONObject()))
        "games"->{val c=a.optString("cursor");require(c.length<600)
            val fromPhone=owner.isNotBlank() && (c.isEmpty() || c.startsWith("lc_"))
            if(fromPhone)runCatching{phone.page(owner,c.ifBlank{null},20,::direct)}.getOrElse{if(c.isNotEmpty())throw it else json(request("games",query=mapOf("limit" to "20")))}
            else json(request("games",query=if(c.isBlank())mapOf("limit" to "20") else mapOf("limit" to "20","cursor" to c)))}
        "game"->{val id=a.getString("id");require(id.matches(Regex("[a-zA-Z0-9]{8,16}")));runCatching{phone.detail(owner,id,::direct)}.getOrElse{json(request("games/"+id))}}
        "book"->{val p=position(a);p.put("source",a.getString("source").also{require(it in setOf("masters","lichess"))})
            for(k in listOf("speeds","ratings"))a.optJSONArray(k)?.let{require(it.length()<=12);p.put(k,it)}
            if(phone.connected(owner))try{phone.explorer(JSONObject(p.toString()).put("fen",a.getString("fen")),owner,::direct)}catch(_:LichessUnauthorized){json(request("study/explorer",p))}
            else json(request("study/explorer",p))}
        "rep-catalog"->library.catalog()
        "rep-create"->library.saveRepertoire(a).also { shelf.changed() }
        "rep-lookup"->library.lookup(a)
        "rep-markers"->library.markers(a)
        "rep-edit"->{library.edit(a);shelf.changed();library.catalog()}
        "rep-undo"->{library.undo(a.getString("token"));shelf.changed();library.catalog()}
        "rep-settings"->{library.saveSettings(a.toString());shelf.changed();JSONObject(library.settings())}
        "rep-get-settings"->JSONObject(library.settings())
        in BackupShelf.actions -> shelf.perform(op, a)
        "rep-download"->{rest.newCall(request("repertoires/index")).execute().use{check(it.isSuccessful){"Library download failed"};library.install(requireNotNull(it.body).byteStream(),it.header("X-Repertoire-SHA256").orEmpty())};library.catalog()}
        else->error("Unsupported action")
    }
    inner class Port {
        @JavascriptInterface fun studyRead(key:String):String = runCatching { studies.read(key) }.getOrElse { "!" }
        @JavascriptInterface fun studySave(header:String, expected:Int, changes:String):String =
            runCatching { studies.save(header, expected.toLong(), changes) }.getOrElse { "!" }
        @JavascriptInterface fun task(id:Int,op:String,raw:String){
            (if(op in BackupShelf.actions) shelf.worker else if(op.startsWith("rep-")) books else jobs).execute {
                try{require(raw.length<240000);reply(id,action(op,JSONObject(raw)))}
                catch(e:Exception){reply(id,JSONObject().put("error",e.message?.take(180)?:"Request failed"),true)}
            }
        }
        @JavascriptInterface fun stop(){searchId=-1;active.getAndSet(null)?.cancel()}
        @JavascriptInterface fun analyze(id:Int,raw:String){
            stop(); if(!visible)return;searchId=id
            searches.execute {
                if(searchId!=id || !visible)return@execute
                try {
                    require(raw.length<16000);val a=JSONObject(raw);val p=position(a)
                    p.put("engines",a.getString("engines").also{require(it in setOf("both","stockfish","leela"))})
                    p.put("nodes",a.optInt("nodes",1000).coerceIn(1,100000)).put("backend",if(a.optString("backend")=="sycl")"sycl" else "cpu")
                    p.put("sf_depth",a.optInt("sf_depth",14).coerceIn(8,24)).put("sf_lines",a.optInt("sf_lines",3).coerceIn(1,8)).put("leela_lines",a.optInt("leela_lines",3).coerceIn(1,8))
                    val call=stream.newCall(request("study/analysis/stream",p))
                    active.set(call)
                    if(searchId!=id || !visible){call.cancel();return@execute}
                    call.execute().use{r->
                        check(r.isSuccessful){if(r.code==409 || r.code==403)"PC analysis blocked; check the account or ongoing games." else "PC unavailable ("+r.code+")"}
                        check(AnalysisStreamReader.read(requireNotNull(r.body).source(),{searchId==id && visible}){f->js("window.frame&&frame("+id+","+JSONObject.quote(f.toString())+")")}){"PC stream interrupted"}
                    }
                }catch(e:Exception){if(searchId==id)js("window.frame&&frame("+id+","+JSONObject.quote(JSONObject().put("event","error").put("data",JSONObject().put("error",e.message?.take(150))).toString())+")")}
            }
        }
        @JavascriptInterface fun copy(text:String){if(text.length<=600000)runOnUiThread{(getSystemService(CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("Quietboard",text))}}
        @JavascriptInterface fun protect(value:Boolean){runOnUiThread{val f=android.view.WindowManager.LayoutParams.FLAG_SECURE;if(value)window.addFlags(f)else window.clearFlags(f)}}
    }
}
