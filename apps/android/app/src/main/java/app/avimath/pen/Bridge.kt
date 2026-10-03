package app.avimath.pen

import android.app.Activity
import android.content.Intent
import android.util.Base64
import android.webkit.JavascriptInterface
import androidx.core.content.FileProvider
import java.io.File

private val UNSAFE_NAME = Regex("[^A-Za-z0-9._-]")

/**
 * The one thing the page cannot do for itself: put a file where a person can reach
 * it. A WebView ignores `<a download>` and blob: URLs, so the board's export would
 * otherwise be a button that does nothing.
 *
 * Deliberately ONE generic method rather than one per export. Whatever the page hands
 * out next — the board as a PNG, the LaTeX as a file, one exercise on its own — is a
 * web change, not a new APK.
 *
 * Exposed as `AndroidPad`. It is reachable only from our own origin, because navigation
 * is locked to HOST (see PadWebClient). That is what makes exposing it defensible at all.
 */
class Bridge(private val activity: Activity) {
  @JavascriptInterface
  fun version(): String = WRAPPER

  /** Hand `base64` to the share sheet as a file called `name`. Returns false if it
   *  could not be written, so the page can say so rather than look broken. */
  @JavascriptInterface
  fun share(name: String, mime: String, base64: String): Boolean = runCatching {
    val safe = name.replace(UNSAFE_NAME, "_").ifEmpty { "file" }
    val dir = File(activity.cacheDir, "share").apply { mkdirs() }
    val file = File(dir, safe)
    file.writeBytes(Base64.decode(base64, Base64.DEFAULT))
    val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.files", file)
    val send = Intent(Intent.ACTION_SEND).apply {
      type = mime.ifEmpty { "application/octet-stream" }
      putExtra(Intent.EXTRA_STREAM, uri)
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    activity.runOnUiThread { activity.startActivity(Intent.createChooser(send, safe)) }
    true
  }.getOrElse { false }
}
