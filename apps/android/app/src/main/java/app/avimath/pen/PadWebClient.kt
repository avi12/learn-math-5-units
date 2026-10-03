package app.avimath.pen

import android.app.Activity
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient

/** Keeps the WebView on our own origin, and greets every page that finishes loading. */
class PadWebClient(private val activity: Activity, private val onPageLoaded: () -> Unit) : WebViewClient() {
  /** Everything off our own origin opens in a real browser instead. The page is
   *  told things by this app and can call into it; a foreign page must never be
   *  the one holding that. */
  override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
    if (request.url.host == HOST) {
      return false
    }

    activity.openOutside(request.url)
    return true
  }

  override fun onPageFinished(view: WebView, url: String) {
    onPageLoaded()
  }
}
