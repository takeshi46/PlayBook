package app.playbook;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.IBinder;
import android.os.PowerManager;

// ?????????????????????????????? CPU ??????
public class KeepAliveService extends Service {
    private PowerManager.WakeLock lock;

    @Override public int onStartCommand(Intent intent, int flags, int id) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel("tts", "????", NotificationManager.IMPORTANCE_LOW));
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new Notification.Builder(this, "tts")
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle("PlayBook ?????").setContentIntent(open).setOngoing(true).build();
        startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        if (lock == null) {
            lock = getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "playbook:tts");
            lock.acquire(6 * 60 * 60 * 1000L);   // ponytail: ??6???????????????
        }
        return START_NOT_STICKY;
    }

    @Override public void onDestroy() { if (lock != null && lock.isHeld()) lock.release(); super.onDestroy(); }

    @Override public IBinder onBind(Intent i) { return null; }
}
