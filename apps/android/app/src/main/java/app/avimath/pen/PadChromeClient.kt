package app.avimath.pen

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.view.View
import android.view.ViewGroup
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.widget.FrameLayout

private const val REQ_PERMISSION = 41
private const val REQ_FILES = 42

fun fillParent(): FrameLayout.LayoutParams =
  FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)

/**
 * A bare WebChromeClient is already worth having: without any chrome client at all a
 * WebView answers confirm() and prompt() itself, instantly, with "no", so a button that
 * asks before wiping the board simply does nothing. The overrides below add the rest of
 * what a page can ask for — camera, files, fullscreen — each of which is otherwise
 * silently refused and looks like a broken button rather than a missing capability.
 *
 * The Activity owns the OS round trips, so it forwards their answers here through
 * [onPermissionResult] and [onFilesResult].
 */
class PadChromeClient(private val activity: Activity, private val web: WebView) : WebChromeClient() {
  /** A page request parked while the OS asks the user about it. */
  private var pendingPermission: PermissionRequest? = null
  private var pendingNeeds: List<String> = emptyList()
  private var pendingFiles: ValueCallback<Array<Uri>>? = null

  /** The view a page puts up for fullscreen video, and what it covered. */
  private var customView: View? = null
  private var customCallback: CustomViewCallback? = null

  val isFullscreen: Boolean get() = customView != null

  // ---------------------------------------------------------------- permissions --

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
    activity.requestPermissions(missing.toTypedArray(), REQ_PERMISSION)
  }

  override fun onPermissionRequestCanceled(request: PermissionRequest) {
    pendingPermission = null
  }

  fun onPermissionResult(code: Int) {
    if (code != REQ_PERMISSION) {
      return
    }

    val request = pendingPermission ?: return
    pendingPermission = null
    if (!pendingNeeds.all { granted(it) }) {
      request.deny()
      return
    }

    request.grant(request.resources)
  }

  private fun osPermission(resource: String): String? = when (resource) {
    PermissionRequest.RESOURCE_VIDEO_CAPTURE -> Manifest.permission.CAMERA
    PermissionRequest.RESOURCE_AUDIO_CAPTURE -> Manifest.permission.RECORD_AUDIO
    else -> null // protected media and MIDI need nothing from the OS
  }

  // minSdk is 24, so runtime permissions (API 23) always exist
  private fun granted(permission: String): Boolean =
    activity.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED

  // ---------------------------------------------------------------------- files --

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
      activity.startActivityForResult(params.createIntent(), REQ_FILES)
      true
    }.getOrElse {
      pendingFiles = null
      false
    }
  }

  fun onFilesResult(code: Int, result: Int, data: Intent?) {
    if (code != REQ_FILES) {
      return
    }

    val callback = pendingFiles ?: return
    pendingFiles = null
    if (result != Activity.RESULT_OK) {
      callback.onReceiveValue(null)
      return
    }

    callback.onReceiveValue(FileChooserParams.parseResult(result, data))
  }

  // ----------------------------------------------------------------- fullscreen --

  override fun onShowCustomView(view: View, callback: CustomViewCallback) {
    if (customView != null) {
      callback.onCustomViewHidden()
      return
    }

    customView = view
    customCallback = callback
    activity.addContentView(view, fillParent())
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
