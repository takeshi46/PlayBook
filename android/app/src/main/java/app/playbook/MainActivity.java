package app.playbook;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

// Play ブックスを WebView で開き、同梱のユーザースクリプトを注入。読み上げは端末の TTS で行う。
public class MainActivity extends Activity {
    // vivo 端末の標準エンジンは日本語を中国語で読むため、既定は Google 音声サービスにする。
    private static final String DEFAULT_ENGINE = "com.google.android.tts";

    private WebView web;
    private TextToSpeech tts;
    private SharedPreferences prefs;
    private String engine;
    private boolean ttsReady, jaVoice;
    private JavaScriptReplyProxy reply;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences("playbook", MODE_PRIVATE);
        if (Build.VERSION.SDK_INT >= 33) requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
        initTts(prefs.getString("engine", DEFAULT_ENGINE));
        // デバッグ版のときだけ、PC の Chrome（chrome://inspect）から画面構造を調べられるようにする。
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true);
        web = new WebView(this);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        // Google は埋め込み WebView（UA に "; wv"）でのログインを拒否することがあるため外す。
        s.setUserAgentString(s.getUserAgentString().replace("; wv", ""));
        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(web, true);
        web.setWebViewClient(new WebViewClient());
        inject();
        web.loadUrl("https://play.google.com/books");
    }

    // 指定エンジンで TTS を作り直す。使えないエンジンなら端末の既定に戻す。
    private void initTts(String eng) {
        if (tts != null) tts.shutdown();
        ttsReady = false; jaVoice = false; engine = eng;
        tts = new TextToSpeech(this, status -> {
            ttsReady = status == TextToSpeech.SUCCESS;
            if (ttsReady) { pickJapanese(); sendInfo(); }
            else if (eng != null) { prefs.edit().remove("engine").apply(); initTts(null); }
        }, eng);
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override public void onStart(String id) {
                Voice v = tts.getVoice();
                send(id, "voice", v == null ? "?" : v.getName() + " " + v.getLocale());
            }
            @Override public void onDone(String id) { send(id, "end", ""); }
            @Override public void onError(String id) { send(id, "error", "synthesis-failed"); }
            @Override public void onError(String id, int code) { send(id, "error", "tts-error-" + code); }
        });
    }

    // 日本語の声だけを対象にする（中国語などで読まれないように）。
    private List<Voice> japaneseVoices() {
        List<Voice> out = new ArrayList<>();
        try {
            for (Voice v : tts.getVoices()) {
                if (v.getLocale().getLanguage().equals("ja")
                        && !v.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)) out.add(v);
            }
        } catch (Exception e) { /* 声一覧が取れない場合は言語指定のみで読む */ }
        return out;
    }

    // 保存した声があればそれ、なければオフラインで使える日本語の声を選ぶ。
    private void pickJapanese() {
        tts.setLanguage(Locale.JAPAN);
        String saved = prefs.getString("voice", "");
        Voice best = null;
        for (Voice v : japaneseVoices()) {
            if (v.getName().equals(saved)) { best = v; break; }
            if (best == null || (best.isNetworkConnectionRequired() && !v.isNetworkConnectionRequired())) best = v;
        }
        jaVoice = best != null;
        if (best != null) tts.setVoice(best);
    }

    // エンジン・声の一覧と現在の選択をスクリプトへ送る。
    private void sendInfo() {
        runOnUiThread(() -> {
            if (reply == null || !ttsReady) return;
            try {
                JSONArray engines = new JSONArray(), voices = new JSONArray();
                for (TextToSpeech.EngineInfo e : tts.getEngines())
                    engines.put(new JSONObject().put("n", e.name).put("l", e.label));
                for (Voice v : japaneseVoices())
                    voices.put(new JSONObject().put("n", v.getName())
                            .put("l", v.getName() + (v.isNetworkConnectionRequired() ? "（オンライン）" : "")));
                Voice cur = tts.getVoice();
                String name = engine != null ? engine : tts.getDefaultEngine();
                reply.postMessage(new JSONObject().put("e", "info").put("engines", engines).put("engine", name)
                        .put("voices", voices).put("voice", cur == null ? "" : cur.getName()).toString());
            } catch (Exception e) { /* 一覧が作れなければ送らない */ }
        });
    }

    private void inject() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
                || !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        try (InputStream in = getAssets().open("play-books-vertical.user.js")) {
            String js = new String(in.readAllBytes(), "UTF-8");
            WebViewCompat.addDocumentStartJavaScript(web, js,
                    Set.of("https://play.google.com", "https://books.googleusercontent.com"));
            // 読み上げの橋渡しはリーダー本体の iframe にだけ公開する。
            WebViewCompat.addWebMessageListener(web, "PBNative", Set.of("https://books.googleusercontent.com"),
                    (view, message, origin, isMain, proxy) -> { reply = proxy; handle(message.getData()); });
        } catch (Exception e) { throw new RuntimeException(e); }
    }

    private void handle(String data) {
        try {
            JSONObject m = new JSONObject(data);
            switch (m.getString("c")) {
                case "stop":
                    reading = false;
                    tts.stop();
                    stopService(new Intent(this, KeepAliveService.class));
                    break;
                case "info":
                    sendInfo();
                    break;
                case "engine":
                    tts.stop();
                    prefs.edit().putString("engine", m.getString("n")).remove("voice").apply();
                    initTts(m.getString("n"));
                    break;
                case "voice":
                    prefs.edit().putString("voice", m.getString("n")).apply();
                    for (Voice v : japaneseVoices()) if (v.getName().equals(m.getString("n"))) tts.setVoice(v);
                    break;
                case "speak":
                    speak(m);
                    break;
                default:
            }
        } catch (Exception e) { /* 不正なメッセージは無視 */ }
    }

    private void speak(JSONObject m) throws Exception {
        String id = String.valueOf(m.getInt("id"));
        if (!ttsReady) { send(id, "error", "tts-not-ready"); return; }
        if (!jaVoice) { send(id, "error", "日本語の声がありません"); return; }
        startForegroundService(new Intent(this, KeepAliveService.class));
        if (!reading) { reading = true; if (stopped) handler.post(keepRunning); }
        tts.setSpeechRate((float) m.optDouble("r", 1));
        tts.speak(m.getString("t"), TextToSpeech.QUEUE_ADD, null, id);
    }

    private void send(String id, String type, String msg) {
        runOnUiThread(() -> { if (reply != null) reply.postMessage(
                "{\"id\":" + id + ",\"e\":\"" + type + "\",\"m\":\"" + msg + "\"}"); });
    }

    @Override public void onBackPressed() { if (web.canGoBack()) web.goBack(); else super.onBackPressed(); }

    // 他のアプリを前面にしても、読み上げ（ページ送りなど）が止まらないよう、WebView を「表示中」のままにする。
    // 裏に回ると WebView は表示なしと判断され、中の JS（タイマー・メッセージ）が止まるため。
    // 画面が隠れた通知は少し遅れて届くので、読み上げ中は1秒ごとに「表示中」と伝え直す。
    private boolean reading, stopped;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable keepRunning = new Runnable() {
        @Override public void run() {
            if (!reading || !stopped) return;
            web.dispatchWindowVisibilityChanged(View.VISIBLE);
            web.resumeTimers();
            handler.postDelayed(this, 1000);
        }
    };
    @Override protected void onStop() { super.onStop(); stopped = true; handler.post(keepRunning); }
    @Override protected void onStart() { super.onStart(); stopped = false; }

    @Override protected void onDestroy() { tts.shutdown(); super.onDestroy(); }
}
