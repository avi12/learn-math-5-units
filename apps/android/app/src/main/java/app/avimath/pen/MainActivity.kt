package app.avimath.pen

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Base64
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.core.content.FileProvider
import java.io.File

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
 * ── THIS FILE IS MEANT TO BE FINISHED ───────────────────────────────────────────────
 *
 * Every reinstall is a trip across the room with a cable or a QR, so the design goal is
 * that a change to how the pad BEHAVES is never a change to this file. Two rules hold
 * that line:
 *
 *   1. It decides nothing. `buttonState` and `toolType` reach the page as the integers
 *      Android produced, and the page works out what they mean. Erase on the button,
 *      erase on the eraser end, a different gesture entirely — all of that is a web
 *      deploy, and a web deploy already reloads every open tab by itself.
 *
 *   2. It answers every capability a WebView can be asked for, generically and up front,
 *      rather than one at a time as each turns out to be missing. A WebView with no
 *      chrome client silently refuses JS dialogs; with no permission handler it silently
 *      refuses the camera; with no download listener it silently ignores downloads; with
 *      no file chooser it silently ignores `<input type=file>`. Every one of those looks
 *      like a broken button rather than a missing capability, and every one of them
 *      would otherwise have cost an install to find out about.
 *
 * What could still need a new APK: a WebView setting nobody has wanted yet, or a new
 * field to report. Not a new gesture, not a new export, not a new permission.
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private var held = false

    /** The last thing reported, so an unchanged state is not sent a hundred times a
     *  second. Cleared on every page load, because a reloaded page has heard nothing. */
    private var lastSignal = ""

    /** A page request parked while the OS asks the user about it. */
    private var pendingPermission: PermissionRequest? = null
    private var pendingNeeds: List<String> = emptyList()
    private var pendingFiles: ValueCallback<Array<Uri>>? = null

    /** The view a page puts up for fullscreen video, and what it covered. */
    private var customView: View? = null
    private var customCallback: WebChromeClient.CustomViewCallback? = null

    companion object {
        private const val URL = "https://your-site.web.app/?role=pad"
        private const val HOST = "your-site.web.app"

        /** Reported to the page, so one `?pendebug` screenshot says which APK is on the
         *  tablet. Bump it when this file changes; nothing else depends on it. */
        private const val WRAPPER = "2.0"

        private const val REQ_PERMISSION = 41
        private const val REQ_FILES = 42

        /** Every way a stylus says "my button is down". BUTTON_STYLUS_PRIMARY is what a
         *  Galaxy Tab sends; the other two cost nothing and cover pens that do not. */
        private const val PEN_BUTTONS =
            MotionEvent.BUTTON_STYLUS_PRIMARY or
                MotionEvent.BUTTON_STYLUS_SECONDARY or
                MotionEvent.BUTTON_SECONDARY
    }

    // ---------------------------------------------------------------- lifecycle --

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        WebView.setWebContentsDebuggingEnabled(true) // inspectable over adb like any tab
        web = WebView(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            settings.javaScriptEnabled = true
            // localStorage holds the room id — without this the tablet joins a new room
            // on every launch and the desktop mirror watches an empty board
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            keepScreenOn = true
            webViewClient = client
            webChromeClient = chrome
            // The bridge is reachable only from our own origin, because navigation is
            // locked to HOST below. That is what makes exposing it defensible at all.
            addJavascriptInterface(Bridge(), "AndroidPad")
            // A WebView ignores downloads unless told what to do with them. blob: and
            // data: cannot be handed to a system downloader, and those are exactly what
            // a canvas export produces — the page uses AndroidPad.share() for them.
            setDownloadListener { url, _, _, _, _ ->
                if (url.startsWith("http")) {
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
                }
            }
        }
        setContentView(web)
        if (state == null) web.loadUrl(target(intent))
    }

    override fun onNewIntent(next: Intent?) {
        super.onNewIntent(next)
        next?.data?.let { web.loadUrl(target(next)) }
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
        when {
            customView != null -> chrome.onHideCustomView()
            web.canGoBack() -> web.goBack()
            else -> @Suppress("DEPRECATION") super.onBackPressed()
        }
    }

    /** The room the tablet should join.
     *
     *  A link from outside — the QR on the desktop mirror, a link sent to self — carries
     *  `?room=`, and honouring it is the point of being launchable at all: the WebView
     *  keeps its own localStorage, so without this the app always opens a room of its
     *  own. `role=pad` is appended only if the link is silent about it. */
    private fun target(from: Intent?): String {
        val link = from?.data?.takeIf { it.host == HOST }?.toString() ?: return URL
        return if (link.contains("role=")) link
        else link + (if ('?' in link) "&" else "?") + "role=pad"
    }

    // ------------------------------------------------------------------ the pen --

    /** Contact. The button state rides along on every touch event. */
    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        val down = report(ev)
        if (!down) return super.dispatchTouchEvent(ev)
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
        report(ev)
        return super.dispatchGenericMotionEvent(ev)
    }

    /** Tell the page what the pen reported, and answer whether a button is down. Only on
     *  CHANGE: touch events arrive well over a hundred times a second. */
    private fun report(ev: MotionEvent): Boolean {
        val down = (ev.buttonState and PEN_BUTTONS) != 0
        val tool = if (ev.pointerCount > 0) ev.getToolType(0) else MotionEvent.TOOL_TYPE_UNKNOWN
        val signal = "$down/${ev.buttonState}/$tool"
        if (signal == lastSignal) return down
        lastSignal = signal
        held = down
        web.evaluateJavascript(
            "window.__pen && window.__pen({\"button\":$down,\"buttonState\":${ev.buttonState}" +
                ",\"toolType\":$tool,\"wrapper\":\"$WRAPPER\"})",
            null
        )
        return down
    }

    /** The same event, with buttonState cleared.
     *
     *  MotionEvent has no setter for it, so the event is rebuilt through the obtain()
     *  overload that takes buttonState explicitly. Pointer properties carry the tool
     *  type and pointer coords carry pressure and tilt; losing either would turn the pen
     *  into a finger halfway through a stroke. */
    private fun stripButtons(ev: MotionEvent): MotionEvent {
        val n = ev.pointerCount
        val props = Array(n) { i ->
            MotionEvent.PointerProperties().also { ev.getPointerProperties(i, it) }
        }
        val coords = Array(n) { i ->
            MotionEvent.PointerCoords().also { ev.getPointerCoords(i, it) }
        }
        return MotionEvent.obtain(
            ev.downTime, ev.eventTime,
            ev.action, // not actionMasked: the pointer index has to survive
            n, props, coords,
            ev.metaState,
            0, // buttonState — the one thing that changes
            ev.xPrecision, ev.yPrecision, ev.deviceId, ev.edgeFlags, ev.source, ev.flags
        )
    }

    // ---------------------------------------------------------------- web client --

    private val client = object : WebViewClient() {
        /** Everything off our own origin opens in a real browser instead. The page is
         *  told things by this Activity and can call into it; a foreign page must never
         *  be the one holding that. */
        override fun shouldOverrideUrlLoading(
            view: WebView,
            request: WebResourceRequest
        ): Boolean {
            if (request.url.host == HOST) return false
            runCatching { startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
            return true
        }

        override fun onPageFinished(view: WebView, url: String) {
            lastSignal = ""
            view.evaluateJavascript(
                "window.__pen && window.__pen({\"hello\":true,\"wrapper\":\"$WRAPPER\"})",
                null
            )
        }
    }

    // ------------------------------------------------------------- chrome client --

    /** A bare WebChromeClient is already worth having: without any chrome client at all a
     *  WebView answers confirm() and prompt() itself, instantly, with "no", so a button
     *  that asks before wiping the board simply does nothing. The overrides below add the
     *  rest of what a page can ask for. */
    private val chrome = object : WebChromeClient() {

        /** Camera, microphone, anything else. Generic on purpose: a new capability in
         *  the page must not turn into a new APK. */
        override fun onPermissionRequest(request: PermissionRequest) {
            val needs = request.resources.mapNotNull { osPermission(it) }.distinct()
            val missing = needs.filterNot { granted(it) }
            if (missing.isEmpty()) {
                request.grant(request.resources)
                return
            }
            // Held rather than denied: a denial makes the page report "no camera", which
            // is not what happened — the user has not been asked yet.
            pendingPermission = request
            pendingNeeds = needs
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                requestPermissions(missing.toTypedArray(), REQ_PERMISSION)
            } else {
                request.grant(request.resources)
            }
        }

        override fun onPermissionRequestCanceled(request: PermissionRequest) {
            pendingPermission = null
        }

        /** `<input type="file">` — silently dead without this. */
        override fun onShowFileChooser(
            view: WebView,
            callback: ValueCallback<Array<Uri>>,
            params: FileChooserParams
        ): Boolean {
            pendingFiles?.onReceiveValue(null)
            pendingFiles = callback
            return runCatching {
                @Suppress("DEPRECATION")
                startActivityForResult(params.createIntent(), REQ_FILES)
                true
            }.getOrElse {
                pendingFiles = null
                false
            }
        }

        override fun onShowCustomView(view: View, callback: CustomViewCallback) {
            if (customView != null) {
                callback.onCustomViewHidden()
                return
            }
            customView = view
            customCallback = callback
            addContentView(
                view,
                FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
            )
            web.visibility = View.GONE
        }

        override fun onHideCustomView() {
            val view = customView ?: return
            (view.parent as? ViewGroup)?.removeView(view)
            customView = null
            web.visibility = View.VISIBLE
            customCallback?.onCustomViewHidden()
            customCallback = null
        }
    }

    private fun osPermission(resource: String): String? = when (resource) {
        PermissionRequest.RESOURCE_VIDEO_CAPTURE -> Manifest.permission.CAMERA
        PermissionRequest.RESOURCE_AUDIO_CAPTURE -> Manifest.permission.RECORD_AUDIO
        else -> null // protected media and MIDI need nothing from the OS
    }

    private fun granted(permission: String): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
            checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED

    override fun onRequestPermissionsResult(
        code: Int,
        permissions: Array<out String>,
        results: IntArray
    ) {
        super.onRequestPermissionsResult(code, permissions, results)
        if (code != REQ_PERMISSION) return
        val request = pendingPermission ?: return
        pendingPermission = null
        if (pendingNeeds.all { granted(it) }) request.grant(request.resources) else request.deny()
    }

    @Deprecated("Activity.onActivityResult")
    override fun onActivityResult(code: Int, result: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(code, result, data)
        if (code != REQ_FILES) return
        val callback = pendingFiles ?: return
        pendingFiles = null
        callback.onReceiveValue(
            if (result == RESULT_OK) WebChromeClient.FileChooserParams.parseResult(result, data)
            else null
        )
    }

    // --------------------------------------------------------------- the bridge --

    /**
     * The one thing the page cannot do for itself: put a file where a person can reach
     * it. A WebView ignores `<a download>` and blob: URLs, so the board's export would
     * otherwise be a button that does nothing.
     *
     * Deliberately ONE generic method rather than one per export. Whatever the page hands
     * out next — the board as a PNG, the LaTeX as a file, one exercise on its own — is a
     * web change, not a new APK.
     */
    private inner class Bridge {
        @JavascriptInterface
        fun version(): String = WRAPPER

        /** Hand `base64` to the share sheet as a file called `name`. Returns false if it
         *  could not be written, so the page can say so rather than look broken. */
        @JavascriptInterface
        fun share(name: String, mime: String, base64: String): Boolean = runCatching {
            val safe = name.replace(Regex("[^A-Za-z0-9._-]"), "_").ifEmpty { "file" }
            val dir = File(cacheDir, "share").apply { mkdirs() }
            val file = File(dir, safe)
            file.writeBytes(Base64.decode(base64, Base64.DEFAULT))
            val uri = FileProvider.getUriForFile(this@MainActivity, "$packageName.files", file)
            val send = Intent(Intent.ACTION_SEND).apply {
                type = mime.ifEmpty { "application/octet-stream" }
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            runOnUiThread { startActivity(Intent.createChooser(send, safe)) }
            true
        }.getOrElse { false }
    }
}
