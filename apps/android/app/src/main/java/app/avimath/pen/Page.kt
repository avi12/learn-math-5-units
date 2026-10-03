package app.avimath.pen

import android.app.Activity
import android.content.Intent
import android.content.res.Configuration
import android.content.res.Resources
import android.net.Uri
import android.webkit.WebView
import org.json.JSONObject

const val HOST = BuildConfig.PAD_HOST
private const val HOME = "https://$HOST/?role=pad"

/** Reported to the page, so one `?pendebug` screenshot says which APK is on the tablet.
 *  It IS the versionName in build.gradle.kts — bump that, and only that. */
const val WRAPPER = BuildConfig.VERSION_NAME

/**
 * The one way anything native reaches the page: `window.__pen({...})`.
 *
 * Every message carries `wrapper`, so the page never has to ask which APK it is in.
 * The fields go through JSONObject rather than a hand-built string, so a value can
 * never break the script it is spliced into.
 */
class Page(private val web: WebView) {
  fun tell(vararg fields: Pair<String, Any>) {
    val json = JSONObject(mapOf(*fields, "wrapper" to WRAPPER))
    web.evaluateJavascript("window.__pen && window.__pen($json)", null)
  }
}

/** Is the tablet in dark mode?
 *
 *  The page has a dark palette of its own and asks for it with `prefers-color-scheme`,
 *  which inside a WebView follows the app theme's `android:isLightTheme` and nothing
 *  else. That attribute is API 29 and this tablet is API 28, so the media query can
 *  never be right here however the theme is written — measured in the running app over
 *  adb: `prefers-color-scheme: light` with the tablet plainly in dark mode. Hence the
 *  wrapper reading it natively and handing it over the same bridge as the pen.
 *
 *  ONE source, and it is the documented one. A settings-row fallback for Samsung's
 *  `display_night_theme` was written here first, on the inference that One UI 1 keeps
 *  its night theme to itself — that inference was wrong. `secure.ui_night_mode` is the
 *  user's *preference* and does read 0, which is what misled it, but the resolved
 *  Configuration carries `-night-` all the same (`adb shell am get-config`), and this
 *  branch alone answered correctly through a real toggle on the device. A second
 *  source that can disagree with the first is a drift waiting to happen, so there
 *  isn't one. */
fun isDark(resources: Resources): Boolean = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
  Configuration.UI_MODE_NIGHT_YES

/** The room the tablet should join.
 *
 *  A link from outside — the QR on the desktop mirror, a link sent to self — carries
 *  `?room=`, and honouring it is the point of being launchable at all: the WebView
 *  keeps its own localStorage, so without this the app always opens a room of its
 *  own. `role=pad` is appended only if the link is silent about it. */
fun target(from: Intent?): String {
  val link = from?.data?.takeIf { it.host == HOST }?.toString() ?: return HOME
  if (link.contains("role=")) {
    return link
  }

  val joiner = if ('?' in link) "&" else "?"
  return "${link}${joiner}role=pad"
}

/** Hand a link to whatever else on the tablet opens it. Nothing installed is not an error. */
fun Activity.openOutside(uri: Uri) {
  runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
}
