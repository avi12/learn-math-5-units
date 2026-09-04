plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
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
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        // Debug only, on purpose: this is sideloaded onto one tablet, and a debug build
        // is signed with the local debug key without any keystore to keep or lose.
        getByName("debug") {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    // FileProvider only. A WebView cannot share a blob: URL, and handing a raw file://
    // URI to another app throws on anything since Android N, so a content provider is
    // the only way the board's PNG reaches the share sheet.
    implementation("androidx.core:core:1.13.1")
}
