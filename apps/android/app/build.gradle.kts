plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
  id("org.jlleitschuh.gradle.ktlint")
  id("io.gitlab.arturbosch.detekt")
}

android {
  namespace = "app.avimath.pen"
  compileSdk = 34

  defaultConfig {
    applicationId = "app.avimath.pen"
    // The Galaxy Tab S3 shipped on Android 8/9; 24 leaves room below it and costs
    // nothing, because the whole app is one WebView and one MotionEvent field.
    minSdk = 24
    targetSdk = 34
    versionCode = 2
    versionName = "2.1" // the page reads it as WRAPPER (Page.kt), via BuildConfig

    // Which deployed board the wrapper opens. From `padHost` in local.properties (or
    // -PpadHost=...), never from the source: the code is public, the board is not.
    val padHost = providers.gradleProperty("padHost").orNull
      ?: java.util.Properties().apply {
        rootProject.file("local.properties").takeIf { it.exists() }?.inputStream()?.use { load(it) }
      }.getProperty("padHost")
      ?: error("Set padHost=<your-site>.web.app in android/local.properties")
    buildConfigField("String", "PAD_HOST", "\"$padHost\"")
    manifestPlaceholders["padHost"] = padHost
  }

  buildTypes {
    // Debug only, on purpose: this is sideloaded onto one tablet, and a debug build
    // is signed with the local debug key without any keystore to keep or lose.
    getByName("debug") {
      // R8 tree-shakes and shrinks the debug build too: androidx.core is mostly
      // code this app never calls. The default rules already keep every
      // @JavascriptInterface method, which is all the page reaches by name.
      isMinifyEnabled = true
      isShrinkResources = true
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
    }
  }

  buildFeatures {
    buildConfig = true
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
  kotlinOptions {
    jvmTarget = "17"
  }
}

ktlint {
  version.set("1.3.1")
}

detekt {
  buildUponDefaultConfig = true
  config.setFrom(files("$rootDir/config/detekt.yml"))
}

dependencies {
  // FileProvider only. A WebView cannot share a blob: URL, and handing a raw file://
  // URI to another app throws on anything since Android N, so a content provider is
  // the only way the board's PNG reaches the share sheet.
  implementation("androidx.core:core:1.13.1")
}
