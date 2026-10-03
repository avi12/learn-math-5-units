// Versions are pinned to what is already in the Gradle cache on this machine, so a build
// needs no new toolchain download: AGP 8.5.2 with Kotlin 1.9.24, on Gradle 8.9.
plugins {
    id("com.android.application") version "8.5.2" apply false
    id("org.jetbrains.kotlin.android") version "1.9.24" apply false
    // Lint, ported from the web side's rules: ktlint formats (.editorconfig), detekt
    // checks logic (config/detekt.yml). These two are the only plugins not pre-cached.
    id("org.jlleitschuh.gradle.ktlint") version "12.1.1" apply false
    id("io.gitlab.arturbosch.detekt") version "1.23.7" apply false
}
