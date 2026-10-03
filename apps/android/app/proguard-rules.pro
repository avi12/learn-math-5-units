# The page calls AndroidPad.version() and AndroidPad.share() by name. The default
# optimize rules keep @JavascriptInterface members already; this says so on purpose,
# so a change of default file can never rename the bridge out from under the page.
-keepclassmembers class app.avimath.pen.Bridge {
    @android.webkit.JavascriptInterface <methods>;
}
