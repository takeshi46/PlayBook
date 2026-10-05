# PlayBook

Google Play ブックスを端末のTTSで読み上げる Android アプリ（WebView）と、元の Userscript。
本文は個人利用の範囲で、リーダーが表示している内容を読み上げるだけ。

## 構成
- `android/` … WebView アプリ。同梱の `play-books-vertical.user.js` を注入し、読み上げは端末の TTS（Google 音声サービスを明示指定）。前面サービスで画面オフでも継続。
- `play-books-vertical.user.js` … 縦スクロール＋読み上げ（v1.10.x）。アプリ内では `PBNative` 経由で端末TTSを使い、ブラウザ単体では Web Speech を使う（Android Chrome では synthesis-failed になる端末あり）。

## 使い方（アプリ）
本を開き、☰ →「▶ 読む」。読み上げ位置の段落を強調して追従。速度ボタンで変更。ルビは除いて読む。

## ビルド
JDK17 と Android SDK（platform 34）、Gradle 8.9 が必要。
```
cd android && gradle assembleDebug   # app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## 確認済み / 未確認
- 確認済み（vivo 端末）: Google ログイン、日本語読み上げ、画面オフ継続。
- 未確認: 長時間の連続再生、ロック画面の操作（現状は通知のみ）、声の選択UI。
- 注意: vivo 端末の標準エンジン（com.vivo.aiservice）は日本語を中国語で読むため、アプリは Google 音声サービスを明示指定している。
