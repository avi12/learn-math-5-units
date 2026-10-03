package app.avimath.pen

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.os.Bundle
import android.view.MotionEvent
import android.webkit.WebView

/**
 * One screen, one WebView, one job: be the window the pad cannot open for itself.
 *
 * The pad IS the website. This app hosts nothing and adds no UI. It exists because of a
 * hole in the platform: Chrome on Android claims a stylus-button touch for text
 * selection, so a page never receives it as a pointer event. Measured on a Galaxy Tab S3
 * with `?pendebug`: an ordinary pen touch prints a line, a touch with the button held
 * prints nothing at all. No web API reaches past that, and neither does WASM, which only
 * ever sees what JavaScript was already given.
 *
 * An Activity, however, sees every MotionEvent before the WebView does, and the button
 * is right there in `buttonState`.
 *
 * ── THIS APP IS MEANT TO BE FINISHED ────────────────────────────────────────────────
 *
 * Every reinstall is a trip across the room with a cable or a QR, so the design goal is
 * that a change to how the pad BEHAVES is never a change to this app. Two rules hold
 * that line:
 *
 *   1. It decides nothing (PenReporter). `buttonState` and `toolType` reach the page as
 *      the integers Android produced, and the page works out what they mean. Erase on
 *      the button, erase on the eraser end, a different gesture entirely — all of that
 *      is a web deploy, and a web deploy already reloads every open tab by itself.
 *
 *   2. It answers every capability a WebView can be asked for, generically and up front
 *      (PadChromeClient, Bridge, the download listener below), rather than one at a time
 *      as each turns out to be missing.
 *
 * What could still need a new APK: a WebView setting nobody has wanted yet, or a new
 * field to report. Not a new gesture, not a new export, not a new permission.
 *
 * This class only wires the parts together and owns the Activity callbacks:
 *   Pen.kt            the stylus button, and the event the WebView gets instead
 *   Page.kt           the one channel to the page, the room link, dark mode
 *   PadWebClient      navigation locked to our origin
 *   PadChromeClient   permissions, file chooser, fullscreen video
 *   Bridge            `AndroidPad.share()` — files out to the share sheet
 */
class MainActivity : Activity() {
  private lateinit var web: WebView
  private lateinit var page: Page
  private lateinit var pen: PenReporter
  private lateinit var chrome: PadChromeClient

  // ---------------------------------------------------------------- lifecycle --

  @SuppressLint("SetJavaScriptEnabled")
  override fun onCreate(state: Bundle?) {
    super.onCreate(state)
    WebView.setWebContentsDebuggingEnabled(true) // inspectable over adb like any tab
    web = WebView(this)
    page = Page(web)
    pen = PenReporter(page)
    chrome = PadChromeClient(this, web)
    web.apply {
      layoutParams = fillParent()
      settings.javaScriptEnabled = true
      // localStorage holds the room id — without this the tablet joins a new room
      // on every launch and the desktop mirror watches an empty board
      settings.domStorageEnabled = true
      settings.mediaPlaybackRequiresUserGesture = false
      settings.allowFileAccess = false
      settings.allowContentAccess = false
      // Pinch-to-zoom is the browser's own, by the viewport <meta> in index.html. A
      // WebView honours it only with its built-in zoom on; the +/- overlay stays off.
      settings.builtInZoomControls = true
      settings.displayZoomControls = false
      keepScreenOn = true
      webViewClient = PadWebClient(this@MainActivity, ::greet)
      webChromeClient = chrome
      addJavascriptInterface(Bridge(this@MainActivity), "AndroidPad")
      // A WebView ignores downloads unless told what to do with them. blob: and
      // data: cannot be handed to a system downloader, and those are exactly what
      // a canvas export produces — the page uses AndroidPad.share() for them.
      setDownloadListener { url, _, _, _, _ ->
        if (url.startsWith("http")) {
          openOutside(Uri.parse(url))
        }
      }
    }
    setContentView(web)
    if (state != null) {
      return
    }

    web.loadUrl(target(intent))
  }

  override fun onNewIntent(next: Intent?) {
    super.onNewIntent(next)
    if (next?.data == null) {
      return
    }

    web.loadUrl(target(next))
  }

  override fun onSaveInstanceState(out: Bundle) {
    super.onSaveInstanceState(out)
    web.saveState(out)
  }

  override fun onRestoreInstanceState(state: Bundle) {
    super.onRestoreInstanceState(state)
    web.restoreState(state)
  }

  @Deprecated("Activity.onBackPressed", ReplaceWith("finish()"))
  override fun onBackPressed() {
    if (chrome.isFullscreen) {
      chrome.onHideCustomView()
      return
    }

    if (web.canGoBack()) {
      web.goBack()
      return
    }

    @Suppress("DEPRECATION")
    super.onBackPressed()
  }

  // ------------------------------------------------------------------ the page --

  /** A freshly loaded page has heard nothing yet: say hello, with the theme. */
  private fun greet() {
    pen.forget()
    page.tell("hello" to true, "dark" to isDark(resources))
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    if (!::page.isInitialized) {
      return
    }

    page.tell("dark" to isDark(resources))
  }

  // ------------------------------------------------------------------- the pen --

  /** Contact. The button state rides along on every touch event. */
  override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
    if (!pen.report(ev)) {
      return super.dispatchTouchEvent(ev)
    }

    // Hand the WebView the same stroke with the button STRIPPED OFF. Not tidiness —
    // it is the whole reason this works. Forwarded untouched, Chromium inside the
    // WebView swallows it exactly as Chrome does, and the page would know the button
    // was down and have no stroke to erase with.
    val clean = stripButtons(ev)
    try {
      return super.dispatchTouchEvent(clean)
    } finally {
      clean.recycle()
    }
  }

  /** Hover. The button is often pressed before the pen lands; saying so now means the
   *  first point of the stroke already erases. */
  override fun dispatchGenericMotionEvent(ev: MotionEvent): Boolean {
    pen.report(ev)
    return super.dispatchGenericMotionEvent(ev)
  }

  // ---------------------------------------------------------- OS round trips --

  override fun onRequestPermissionsResult(code: Int, permissions: Array<out String>, results: IntArray) {
    super.onRequestPermissionsResult(code, permissions, results)
    chrome.onPermissionResult(code)
  }

  @Deprecated("Activity.onActivityResult")
  override fun onActivityResult(code: Int, result: Int, data: Intent?) {
    @Suppress("DEPRECATION")
    super.onActivityResult(code, result, data)
    chrome.onFilesResult(code, result, data)
  }
}
