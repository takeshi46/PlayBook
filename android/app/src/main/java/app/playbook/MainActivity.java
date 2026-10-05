package app.playbook;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import java.io.InputStream;
import java.util.Locale;
import java.util.Set;
import org.json.JSONObject;

// Play ????? WebView ???????????????????????????? TTS ????
public class MainActivity extends Activity {
    private WebView web;
    private TextToSpeech tts;
    private boolean ttsReady, jaVoice;
    private JavaScriptReplyProxy reply;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        if (Build.VERSION.SDK_INT >= 33) requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
        // 端末の既定ではなく Google 音声サービスを明示する（vivo 標準エンジンは日本語を中国語で読むため）。
        tts = new TextToSpeech(this, status -> {
            ttsReady = status == TextToSpeech.SUCCESS;
            if (ttsReady) pickJapanese();
        }, "com.google.android.tts");
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override public void onStart(String id) {
                Voice v = tts.getVoice();
                send(id, "voice", v == null ? "?" : v.getName() + " " + v.getLocale());
            }
            @Override public void onDone(String id) { send(id, "end", ""); }
            @Override public void onError(String id) { send(id, "error", "synthesis-failed"); }
            @Override public void onError(String id, int code) { send(id, "error", "tts-error-" + code); }
        });
        web = new WebView(this);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        // Google ????? WebView?UA ? "; wv"??????????????????????
        s.setUserAgentString(s.getUserAgentString().replace("; wv", ""));
        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(web, true);
        web.setWebViewClient(new WebViewClient());
        inject();
        web.loadUrl("https://play.google.com/books");
    }

    // 中国語などで読まれないよう、日本語の声を明示的に選ぶ（オフラインで使える声を優先）。
    private void pickJapanese() {
        tts.setLanguage(Locale.JAPAN);
        Voice best = null;
        try {
            for (Voice v : tts.getVoices()) {
                if (!v.getLocale().getLanguage().equals("ja")
                        || v.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)) continue;
                if (best == null || (best.isNetworkConnectionRequired() && !v.isNetworkConnectionRequired())) best = v;
            }
        } catch (Exception e) { /* 声一覧が取れない場合は言語指定のみで読む */ }
        jaVoice = best != null;
        if (best != null) tts.setVoice(best);
    }

    private void inject() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
                || !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        try (InputStream in = getAssets().open("play-books-vertical.user.js")) {
            String js = new String(in.readAllBytes(), "UTF-8");
            WebViewCompat.addDocumentStartJavaScript(web, js,
                    Set.of("https://play.google.com", "https://books.googleusercontent.com"));
            // ???????????????? iframe ????????
            WebViewCompat.addWebMessageListener(web, "PBNative", Set.of("https://books.googleusercontent.com"),
                    (view, message, origin, isMain, proxy) -> { reply = proxy; handle(message.getData()); });
        } catch (Exception e) { throw new RuntimeException(e); }
    }

    private void handle(String data) {
        try {
            JSONObject m = new JSONObject(data);
            if ("stop".equals(m.getString("c"))) {
                tts.stop();
                stopService(new Intent(this, KeepAliveService.class));
            } else if (ttsReady && !jaVoice) {
                send(String.valueOf(m.getInt("id")), "error", "日本語の声がありません");
            } else if (ttsReady) {
                startForegroundService(new Intent(this, KeepAliveService.class));
                tts.setSpeechRate((float) m.optDouble("r", 1));
                tts.speak(m.getString("t"), TextToSpeech.QUEUE_ADD, null, String.valueOf(m.getInt("id")));
            } else send(String.valueOf(m.getInt("id")), "error", "tts-not-ready");
        } catch (Exception e) { /* ??????????? */ }
    }

    private void send(String id, String type, String msg) {
        runOnUiThread(() -> { if (reply != null) reply.postMessage(
                "{\"id\":" + id + ",\"e\":\"" + type + "\",\"m\":\"" + msg + "\"}"); });
    }

    @Override public void onBackPressed() { if (web.canGoBack()) web.goBack(); else super.onBackPressed(); }

    @Override protected void onDestroy() { tts.shutdown(); super.onDestroy(); }
}
